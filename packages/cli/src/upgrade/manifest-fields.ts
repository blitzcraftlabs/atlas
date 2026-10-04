import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CliError, CliErrorCode } from "../errors/cli-error";

import {
  ATLAS_MANAGED_MANIFEST_FIELDS,
  GENERATED_CONSUMER_ROOT_VERSION,
  isManagedManifestField,
  manifestFieldId,
  parseManifestField,
  PARTIAL_UPGRADE_1_3_1_BASELINE,
  PARTIAL_UPGRADE_1_3_1_STALE_VALUES,
} from "./manifest-ownership";

import type { ManifestFieldChange, UpgradePlanItem } from "./types";

export interface ReleaseManifestFieldSet {
  owned: string[];
  values: Record<string, string>;
}

export type ReleaseManifestFields = Record<string, ReleaseManifestFieldSet>;

export type ManifestFieldDecision =
  | { kind: "skip"; message: string }
  | {
      kind: "update";
      operation: "set" | "remove";
      message: string;
      recovery?: boolean;
    }
  | { kind: "conflict"; message: string };

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function readManifestFieldValue(
  manifest: Record<string, unknown>,
  field: string
): string | undefined {
  const parsed = parseManifestField(field);
  if (!parsed) {
    return undefined;
  }

  if (parsed.kind === "version") {
    return typeof manifest.version === "string" ? manifest.version : undefined;
  }

  const section = manifest[parsed.section];
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    return undefined;
  }

  const value = (section as Record<string, unknown>)[parsed.name];
  return typeof value === "string" ? value : undefined;
}

export function manifestFieldValueIsMalformed(
  manifest: Record<string, unknown>,
  field: string
): boolean {
  const parsed = parseManifestField(field);
  if (!parsed) {
    return true;
  }

  if (parsed.kind === "version") {
    return manifest.version !== undefined && typeof manifest.version !== "string";
  }

  if (!(parsed.section in manifest)) {
    return false;
  }

  const section = manifest[parsed.section];
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    return true;
  }

  const value = (section as Record<string, unknown>)[parsed.name];
  return value !== undefined && typeof value !== "string";
}

export function writeManifestFieldValue(
  manifest: Record<string, unknown>,
  field: string,
  value: string | undefined
): void {
  const parsed = parseManifestField(field);
  if (!parsed) {
    throw new Error(`Unsupported manifest field ${field}.`);
  }

  if (parsed.kind === "version") {
    if (value === undefined) {
      delete manifest.version;
      return;
    }
    manifest.version = value;
    return;
  }

  const existing = manifest[parsed.section];
  const section =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  if (value === undefined) {
    delete section[parsed.name];
    if (Object.keys(section).length === 0) {
      delete manifest[parsed.section];
      return;
    }
  } else {
    section[parsed.name] = value;
  }

  manifest[parsed.section] = section;
}

export function collectManagedManifestFields(
  repoRoot: string,
  readJson: (absolutePath: string, label: string) => Record<string, unknown>
): ReleaseManifestFields | undefined {
  const fields: ReleaseManifestFields = {};

  for (const entry of ATLAS_MANAGED_MANIFEST_FIELDS) {
    const absolutePath = path.join(repoRoot, entry.relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const manifest = readJson(absolutePath, entry.relativePath);
    const set = fields[entry.relativePath] ?? { owned: [], values: {} };
    if (!set.owned.includes(entry.field)) {
      set.owned.push(entry.field);
    }

    const value = readManifestFieldValue(manifest, entry.field);
    if (value !== undefined) {
      set.values[entry.field] = value;
    } else if (manifestFieldValueIsMalformed(manifest, entry.field)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `${entry.relativePath} field ${entry.field} must be a string when Atlas owns it.`
      );
    }

    fields[entry.relativePath] = set;
  }

  const relativePaths = Object.keys(fields).sort((left, right) => left.localeCompare(right));
  if (relativePaths.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    relativePaths.map((relativePath) => {
      const set = fields[relativePath]!;
      return [
        relativePath,
        {
          owned: [...set.owned].sort((left, right) => left.localeCompare(right)),
          values: sortRecord(set.values),
        },
      ];
    })
  );
}

export function readReleaseManifestFields(value: unknown): ReleaseManifestFields | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      "Release snapshot manifestFields must be an object when present."
    );
  }

  const fields: ReleaseManifestFields = {};
  for (const [relativePath, rawSet] of Object.entries(value as Record<string, unknown>)) {
    if (relativePath.length === 0 || path.isAbsolute(relativePath) || relativePath.includes("..")) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Release snapshot manifestFields key ${JSON.stringify(relativePath)} is not a safe relative path.`
      );
    }

    if (typeof rawSet !== "object" || rawSet === null || Array.isArray(rawSet)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Release snapshot manifestFields[${JSON.stringify(relativePath)}] must be an object.`
      );
    }

    const record = rawSet as Record<string, unknown>;
    if (!Array.isArray(record.owned)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Release snapshot manifestFields[${JSON.stringify(relativePath)}].owned must be an array.`
      );
    }

    const owned: string[] = [];
    for (const [index, field] of record.owned.entries()) {
      if (typeof field !== "string" || !isManagedManifestField(field)) {
        throw new CliError(
          CliErrorCode.UPGRADE_PREREQUISITE,
          `Release snapshot manifestFields[${JSON.stringify(relativePath)}].owned[${index}] is not a managed field.`
        );
      }
      if (owned.includes(field)) {
        throw new CliError(
          CliErrorCode.UPGRADE_PREREQUISITE,
          `Release snapshot manifestFields[${JSON.stringify(relativePath)}] lists ${field} more than once.`
        );
      }
      owned.push(field);
    }

    const values: Record<string, string> = {};
    if (record.values !== undefined) {
      if (
        typeof record.values !== "object" ||
        record.values === null ||
        Array.isArray(record.values)
      ) {
        throw new CliError(
          CliErrorCode.UPGRADE_PREREQUISITE,
          `Release snapshot manifestFields[${JSON.stringify(relativePath)}].values must be an object.`
        );
      }

      for (const [field, fieldValue] of Object.entries(record.values as Record<string, unknown>)) {
        if (!owned.includes(field)) {
          throw new CliError(
            CliErrorCode.UPGRADE_PREREQUISITE,
            `Release snapshot manifestFields[${JSON.stringify(relativePath)}].values[${JSON.stringify(field)}] is not an owned field.`
          );
        }
        if (typeof fieldValue !== "string" || fieldValue.length === 0) {
          throw new CliError(
            CliErrorCode.UPGRADE_PREREQUISITE,
            `Release snapshot manifestFields[${JSON.stringify(relativePath)}].values[${JSON.stringify(field)}] must be a non-empty string.`
          );
        }
        values[field] = fieldValue;
      }
    }

    fields[relativePath] = {
      owned: [...owned].sort((left, right) => left.localeCompare(right)),
      values: sortRecord(values),
    };
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function isPartialUpgradeRecovery(options: {
  baselineAtlasVersion: string;
  fieldId: string;
  consumerValue: string | undefined;
  targetValue: string | undefined;
}): boolean {
  if (options.baselineAtlasVersion !== PARTIAL_UPGRADE_1_3_1_BASELINE) {
    return false;
  }
  if (options.consumerValue === undefined || options.targetValue === undefined) {
    return false;
  }
  if (options.consumerValue === options.targetValue) {
    return false;
  }

  const staleValues = PARTIAL_UPGRADE_1_3_1_STALE_VALUES[options.fieldId];
  return staleValues?.includes(options.consumerValue) ?? false;
}

export function classifyManifestField(options: {
  relativePath: string;
  field: string;
  baselineAtlasVersion: string;
  sourceOwned: boolean;
  targetOwned: boolean;
  sourceValue?: string;
  targetValue?: string;
  consumerValue?: string;
  malformed?: boolean;
  missingManifest?: boolean;
}): ManifestFieldDecision {
  const fieldId = manifestFieldId(options.relativePath, options.field);
  const label = fieldId;

  if (!options.targetOwned) {
    return {
      kind: "skip",
      message: `${label} is not owned by the target Atlas release. Atlas will leave the consumer value untouched.`,
    };
  }

  if (options.missingManifest) {
    return {
      kind: "skip",
      message: `${options.relativePath} is not present in the consumer workspace. Atlas will not create it.`,
    };
  }

  if (options.malformed) {
    return {
      kind: "conflict",
      message: `${label} is not a string in the consumer manifest. Atlas will not overwrite it.`,
    };
  }

  const sourceValue = options.sourceOwned ? options.sourceValue : undefined;
  const targetValue = options.targetValue;
  const consumerValue = options.consumerValue;

  if (consumerValue === targetValue) {
    return {
      kind: "skip",
      message: `${label} is already ${targetValue ?? "absent"} on the target Atlas release.`,
    };
  }

  const adoptingGeneratedRoot =
    options.relativePath === "package.json" &&
    options.field === "version" &&
    consumerValue === GENERATED_CONSUMER_ROOT_VERSION &&
    targetValue !== undefined;

  if (
    !adoptingGeneratedRoot &&
    isPartialUpgradeRecovery({
      baselineAtlasVersion: options.baselineAtlasVersion,
      fieldId,
      consumerValue,
      targetValue,
    })
  ) {
    return {
      kind: "update",
      operation: "set",
      recovery: true,
      message: `${label} is ${consumerValue}, the platform value left behind by the Atlas ${PARTIAL_UPGRADE_1_3_1_BASELINE} upgrader. Atlas will adopt ${targetValue}.`,
    };
  }

  if (!options.sourceOwned || sourceValue === undefined) {
    if (consumerValue === undefined && targetValue !== undefined) {
      return {
        kind: "update",
        operation: "set",
        message: `${label} is absent in the source release. Atlas will add ${targetValue}.`,
      };
    }

    if (consumerValue !== undefined && consumerValue !== targetValue) {
      return {
        kind: "conflict",
        message: `${label} is ${consumerValue}, which does not match the target Atlas release (${targetValue ?? "absent"}). Atlas will not overwrite a consumer modification.`,
      };
    }
  }

  if (targetValue === undefined) {
    if (consumerValue === undefined) {
      return {
        kind: "skip",
        message: `${label} is already absent.`,
      };
    }
    if (consumerValue === sourceValue) {
      return {
        kind: "update",
        operation: "remove",
        message: `${label} ${sourceValue} is removed by the target Atlas release. Atlas will remove it.`,
      };
    }
    return {
      kind: "conflict",
      message: `${label} is ${consumerValue}, which differs from the source Atlas release (${sourceValue ?? "absent"}). Atlas will not remove a consumer modification.`,
    };
  }

  if (adoptingGeneratedRoot || consumerValue === sourceValue) {
    return {
      kind: "update",
      operation: "set",
      message: `${label} ${consumerValue ?? sourceValue ?? "absent"} → ${targetValue}.`,
    };
  }

  return {
    kind: "conflict",
    message: `${label} is ${consumerValue ?? "absent"}, which differs from the source Atlas release (${sourceValue ?? "absent"}) and the target (${targetValue}). Atlas will not overwrite a consumer modification.`,
  };
}

function readConsumerManifest(
  repoRoot: string,
  relativePath: string
): { missing: true } | { missing: false; manifest?: Record<string, unknown> } {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return { missing: true };
  }

  try {
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { missing: false };
    }
    return { missing: false, manifest: parsed as Record<string, unknown> };
  } catch {
    return { missing: false };
  }
}

export function planManifestFieldUpdates(options: {
  repoRoot: string;
  baselineAtlasVersion: string;
  sourceFields?: ReleaseManifestFields;
  targetFields?: ReleaseManifestFields;
}): UpgradePlanItem[] {
  const sourceFields = options.sourceFields ?? {};
  const targetFields = options.targetFields ?? {};
  const relativePaths = [
    ...new Set([...Object.keys(sourceFields), ...Object.keys(targetFields)]),
  ].sort((left, right) => left.localeCompare(right));
  const items: UpgradePlanItem[] = [];

  for (const relativePath of relativePaths) {
    const sourceSet = sourceFields[relativePath];
    const targetSet = targetFields[relativePath];
    const fields = [...new Set([...(sourceSet?.owned ?? []), ...(targetSet?.owned ?? [])])].sort(
      (left, right) => left.localeCompare(right)
    );
    const consumer = readConsumerManifest(options.repoRoot, relativePath);

    for (const field of fields) {
      const sourceOwned = sourceSet?.owned.includes(field) ?? false;
      const targetOwned = targetSet?.owned.includes(field) ?? false;
      const sourceValue = sourceOwned ? sourceSet?.values[field] : undefined;
      const targetValue = targetOwned ? targetSet?.values[field] : undefined;
      const malformed =
        !consumer.missing &&
        (consumer.manifest === undefined ||
          manifestFieldValueIsMalformed(consumer.manifest, field));
      const consumerValue =
        consumer.missing || consumer.manifest === undefined
          ? undefined
          : readManifestFieldValue(consumer.manifest, field);

      const decision = classifyManifestField({
        relativePath,
        field,
        baselineAtlasVersion: options.baselineAtlasVersion,
        sourceOwned,
        targetOwned,
        sourceValue,
        targetValue,
        consumerValue,
        malformed: malformed && targetOwned,
        missingManifest: consumer.missing,
      });

      let operation: ManifestFieldChange["operation"] = "set";
      if (decision.kind === "update") {
        operation = decision.operation;
      } else if (targetValue === undefined) {
        operation = "remove";
      }

      const change: ManifestFieldChange = {
        relativePath,
        field,
        operation,
        sourceOwned,
        targetOwned,
        ...(sourceValue !== undefined ? { sourceValue } : {}),
        ...(targetValue !== undefined ? { targetValue } : {}),
        ...(decision.kind === "update" && decision.recovery ? { recovery: true } : {}),
      };

      if (decision.kind === "skip") {
        items.push({
          relativePath: manifestFieldId(relativePath, field),
          ownershipChannel: "versioned-package",
          category: "patch-safe",
          action: "skip",
          message: decision.message,
          conflict: false,
          securityCritical: false,
          sourceVersion: sourceValue,
          targetVersion: targetValue,
          manifestChange: change,
        });
        continue;
      }

      if (decision.kind === "conflict") {
        items.push({
          relativePath: manifestFieldId(relativePath, field),
          ownershipChannel: "versioned-package",
          category: "manual",
          action: "manual-review",
          message: decision.message,
          conflict: true,
          securityCritical: false,
          sourceVersion: sourceValue,
          targetVersion: targetValue,
          manifestChange: change,
        });
        continue;
      }

      items.push({
        relativePath: manifestFieldId(relativePath, field),
        ownershipChannel: "versioned-package",
        category: "patch-safe",
        action: "package-upgrade",
        message: decision.message,
        conflict: false,
        securityCritical: false,
        sourceVersion: sourceValue,
        targetVersion: targetValue,
        manifestChange: change,
      });
    }
  }

  return items;
}

export function applyManifestFieldChange(options: {
  repoRoot: string;
  change: ManifestFieldChange;
  baselineAtlasVersion: string;
  dryRun?: boolean;
}): { applied: boolean; blockedMessage?: string } {
  const absolutePath = path.join(options.repoRoot, options.change.relativePath);
  const consumer = readConsumerManifest(options.repoRoot, options.change.relativePath);
  if (consumer.missing || consumer.manifest === undefined) {
    return {
      applied: false,
      blockedMessage: `${options.change.relativePath} is missing or invalid. Atlas will not rewrite it.`,
    };
  }

  const decision = classifyManifestField({
    relativePath: options.change.relativePath,
    field: options.change.field,
    baselineAtlasVersion: options.baselineAtlasVersion,
    sourceOwned: options.change.sourceOwned,
    targetOwned: options.change.targetOwned,
    sourceValue: options.change.sourceValue,
    targetValue: options.change.targetValue,
    consumerValue: readManifestFieldValue(consumer.manifest, options.change.field),
    malformed: manifestFieldValueIsMalformed(consumer.manifest, options.change.field),
  });

  if (decision.kind === "skip") {
    return { applied: false };
  }

  if (decision.kind !== "update") {
    return {
      applied: false,
      blockedMessage: decision.message,
    };
  }

  if (!options.dryRun) {
    writeManifestFieldValue(
      consumer.manifest,
      options.change.field,
      decision.operation === "remove" ? undefined : options.change.targetValue
    );
    writeFileSync(absolutePath, `${JSON.stringify(consumer.manifest, null, 2)}\n`, "utf8");
  }

  return { applied: true };
}

export function releaseManifestFieldsHaveEvidence(
  fields: ReleaseManifestFields | undefined
): fields is ReleaseManifestFields {
  return fields !== undefined && Object.keys(fields).length > 0;
}
