import { CliError, CliErrorCode } from "./errors/cli-error";

export interface ParsedCli {
  command?: string;
  cwd?: string;
  debug: boolean;
  dryRun: boolean;
  check: boolean;
  env: "skip" | "copy";
  generateArgs: string[];
  enableArgs: string[];
  initArgs: string[];
  syncArgs: string[];
  upgradeArgs: string[];
  help: boolean;
  json: boolean;
  reference: "keep" | "remove";
  version: boolean;
  positionals: string[];
  targetVersion?: string;
  allowDirty: boolean;
  merge: boolean;
  skipValidation: boolean;
  releasesDir?: string;
}

const GLOBAL_FLAGS = new Set([
  "--help",
  "-h",
  "--version",
  "-v",
  "--json",
  "--debug",
  "--dry-run",
  "--check",
  "--cwd",
  "--reference",
  "--env",
  "--to",
  "--allow-dirty",
  "--merge",
  "--skip-validation",
  "--releases-dir",
]);

function parseFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new CliError(CliErrorCode.USAGE_ERROR, `Missing value for ${flag}`);
  }

  return value;
}

function parseReference(value: string): "keep" | "remove" {
  if (value === "keep" || value === "remove") {
    return value;
  }

  throw new CliError(
    CliErrorCode.USAGE_ERROR,
    `Invalid value for --reference: ${value}. Expected keep or remove.`
  );
}

function parseEnv(value: string): "skip" | "copy" {
  if (value === "skip" || value === "copy") {
    return value;
  }

  throw new CliError(
    CliErrorCode.USAGE_ERROR,
    `Invalid value for --env: ${value}. Expected skip or copy.`
  );
}

function createEmptyParsedCli(): ParsedCli {
  return {
    debug: false,
    dryRun: false,
    check: false,
    env: "skip",
    generateArgs: [],
    enableArgs: [],
    initArgs: [],
    syncArgs: [],
    upgradeArgs: [],
    help: false,
    json: false,
    reference: "keep",
    version: false,
    positionals: [],
    allowDirty: false,
    merge: false,
    skipValidation: false,
  };
}

function parseGlobalArgs(argv: string[]): ParsedCli {
  const parsed = createEmptyParsedCli();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--version":
      case "-v":
        parsed.version = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--debug":
        parsed.debug = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--check":
        parsed.check = true;
        break;
      case "--cwd":
        parsed.cwd = parseFlagValue(argv, index, "--cwd");
        index += 1;
        break;
      case "--reference":
        parsed.reference = parseReference(parseFlagValue(argv, index, "--reference"));
        index += 1;
        break;
      case "--env":
        parsed.env = parseEnv(parseFlagValue(argv, index, "--env"));
        index += 1;
        break;
      case "--to":
        parsed.targetVersion = parseFlagValue(argv, index, "--to");
        index += 1;
        break;
      case "--allow-dirty":
        parsed.allowDirty = true;
        break;
      case "--merge":
        parsed.merge = true;
        break;
      case "--skip-validation":
        parsed.skipValidation = true;
        break;
      case "--releases-dir":
        parsed.releasesDir = parseFlagValue(argv, index, "--releases-dir");
        index += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new CliError(CliErrorCode.USAGE_ERROR, `Unknown option: ${arg}`);
        }
        parsed.positionals.push(arg);
        break;
    }
  }

  return parsed;
}

function parseGlobalFlagsOnly(argv: string[]): { flags: ParsedCli; remainder: string[] } {
  const flags = createEmptyParsedCli();
  const remainder: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    if (!GLOBAL_FLAGS.has(arg)) {
      remainder.push(arg);
      continue;
    }

    switch (arg) {
      case "--help":
      case "-h":
        flags.help = true;
        break;
      case "--version":
      case "-v":
        flags.version = true;
        break;
      case "--json":
        flags.json = true;
        break;
      case "--debug":
        flags.debug = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--check":
        flags.check = true;
        break;
      case "--cwd":
        flags.cwd = parseFlagValue(argv, index, "--cwd");
        index += 1;
        break;
      case "--reference":
        flags.reference = parseReference(parseFlagValue(argv, index, "--reference"));
        index += 1;
        break;
      case "--env":
        flags.env = parseEnv(parseFlagValue(argv, index, "--env"));
        index += 1;
        break;
      case "--to":
        flags.targetVersion = parseFlagValue(argv, index, "--to");
        index += 1;
        break;
      case "--allow-dirty":
        flags.allowDirty = true;
        break;
      case "--merge":
        flags.merge = true;
        break;
      case "--skip-validation":
        flags.skipValidation = true;
        break;
      case "--releases-dir":
        flags.releasesDir = parseFlagValue(argv, index, "--releases-dir");
        index += 1;
        break;
      default:
        remainder.push(arg);
        break;
    }
  }

  return { flags, remainder };
}

function mergeParsedFlags(target: ParsedCli, source: ParsedCli): void {
  target.debug = target.debug || source.debug;
  target.dryRun = target.dryRun || source.dryRun;
  target.check = target.check || source.check;
  target.help = target.help || source.help;
  target.json = target.json || source.json;
  target.cwd = target.cwd ?? source.cwd;
  target.reference = source.reference;
  target.env = source.env;
  target.targetVersion = target.targetVersion ?? source.targetVersion;
  target.allowDirty = target.allowDirty || source.allowDirty;
  target.merge = target.merge || source.merge;
  target.skipValidation = target.skipValidation || source.skipValidation;
  target.releasesDir = target.releasesDir ?? source.releasesDir;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const upgradeIndex = argv.indexOf("upgrade");
  if (upgradeIndex !== -1) {
    const beforeUpgrade = parseGlobalArgs(argv.slice(0, upgradeIndex));
    const afterUpgrade = parseGlobalFlagsOnly(argv.slice(upgradeIndex + 1));
    mergeParsedFlags(beforeUpgrade, afterUpgrade.flags);
    beforeUpgrade.command = "upgrade";
    beforeUpgrade.upgradeArgs = afterUpgrade.remainder;
    beforeUpgrade.positionals = [];
    return beforeUpgrade;
  }

  const syncIndex = argv.indexOf("sync");
  if (syncIndex !== -1) {
    const beforeSync = parseGlobalArgs(argv.slice(0, syncIndex));
    const afterSync = parseGlobalFlagsOnly(argv.slice(syncIndex + 1));
    mergeParsedFlags(beforeSync, afterSync.flags);
    beforeSync.command = "sync";
    beforeSync.syncArgs = afterSync.remainder;
    beforeSync.positionals = [];
    return beforeSync;
  }

  const generateIndex = argv.indexOf("generate");
  if (generateIndex !== -1) {
    const parsed = parseGlobalArgs(argv.slice(0, generateIndex));
    parsed.command = "generate";
    parsed.generateArgs = argv.slice(generateIndex + 1);
    return parsed;
  }

  const enableIndex = argv.indexOf("enable");
  if (enableIndex !== -1) {
    const parsed = parseGlobalArgs(argv.slice(0, enableIndex));
    parsed.command = "enable";
    parsed.enableArgs = argv.slice(enableIndex + 1);
    return parsed;
  }

  const parsed = parseGlobalArgs(argv);

  if (parsed.positionals.length > 0) {
    parsed.command = parsed.positionals[0];
  }

  if (parsed.command === "init") {
    parsed.initArgs = parsed.positionals.slice(1);
    parsed.positionals = parsed.positionals.slice(0, 1);
    return parsed;
  }

  if (parsed.positionals.length > 1) {
    throw new CliError(
      CliErrorCode.USAGE_ERROR,
      `Unexpected arguments: ${parsed.positionals.slice(1).join(" ")}`
    );
  }

  return parsed;
}
