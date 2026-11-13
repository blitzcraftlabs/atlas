#!/usr/bin/env node

import { runContextCommand, writeContextHelp } from "./commands/context";
import { runDoctorCommand, writeDoctorHelp } from "./commands/doctor";
import { parseEnableArgs, runEnableCommand, writeEnableHelp } from "./commands/enable";
import { parseGenerateArgs, runGenerateCommand, writeGenerateHelp } from "./commands/generate";
import { formatInitResult, runInit, writeInitHelp } from "./commands/init";
import {
  formatSyncInfrastructureResult,
  runSyncInfrastructureCommand,
  writeSyncHelp,
} from "./commands/sync";
import { runUpgradeCommand, writeUpgradeHelp } from "./commands/upgrade";
import { CliError, CliErrorCode, isCliError } from "./errors/cli-error";
import { cliErrorFromUnknown } from "./errors/from-contract";
import {
  createOutputWriter,
  writeCommandError,
  writeCommandSuccess,
  writeHelp,
  writeVersion,
} from "./output/write";
import { ExitCode } from "./exit-codes";
import { parseCliArgs, type ParsedCli } from "./parse-args";
import { readCliVersionMetadata } from "./version";

import type { CommandResult } from "./types/result";

export interface RunCliOptions {
  argv?: string[];
  cwd?: string;
  writer?: ReturnType<typeof createOutputWriter>;
}

function argvIncludesFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const writer = options.writer ?? createOutputWriter();
  let commandForError = "atlas";

  try {
    const parsed = parseCliArgs(argv);
    commandForError = parsed.command ?? "atlas";

    if (parsed.help) {
      if (parsed.command === "generate") {
        writeGenerateHelp(writer, parsed.json);
        return ExitCode.SUCCESS;
      }

      if (parsed.command === "enable") {
        writeEnableHelp(writer, parsed.json);
        return ExitCode.SUCCESS;
      }

      if (parsed.command === "doctor") {
        writeDoctorHelp(writer, parsed.json);
        return ExitCode.SUCCESS;
      }

      if (parsed.command === "sync") {
        writeSyncHelp(writer, parsed.json);
        return ExitCode.SUCCESS;
      }

      if (parsed.command === "upgrade") {
        writeUpgradeHelp(writer, parsed.json);
        return ExitCode.SUCCESS;
      }

      if (parsed.command === "context") {
        writeContextHelp(writer, parsed.json);
        return ExitCode.SUCCESS;
      }

      if (parsed.command === "init") {
        writeInitHelp(writer, parsed.json);
        return ExitCode.SUCCESS;
      }

      writeHelp(writer, parsed.json);
      return ExitCode.SUCCESS;
    }

    if (parsed.version) {
      writeVersion(writer, readCliVersionMetadata(), parsed.json);
      return ExitCode.SUCCESS;
    }

    if (!parsed.command) {
      writeHelp(writer, parsed.json);
      return ExitCode.SUCCESS;
    }

    switch (parsed.command) {
      case "init":
        return runInitCommand(parsed, writer);
      case "generate":
        return runGenerateCliCommand(parsed, writer);
      case "enable":
        return runEnableCliCommand(parsed, writer);
      case "doctor":
        return runDoctorCommand({
          cwd: parsed.cwd,
          json: parsed.json,
          writer,
        });
      case "sync":
        return runSyncCliCommand(parsed, writer);
      case "upgrade":
        return runUpgradeCliCommand(parsed, writer);
      case "context":
        return runContextCommand({
          cwd: parsed.cwd,
          json: parsed.json,
          writer,
        });
      default:
        throw new CliError(
          CliErrorCode.USAGE_ERROR,
          `Unknown command: ${parsed.command}. Run atlas --help for available commands.`
        );
    }
  } catch (error) {
    if (error instanceof CliError && error.message === "generate-help") {
      writeGenerateHelp(writer, argvIncludesFlag(argv, "--json"));
      return ExitCode.SUCCESS;
    }

    if (error instanceof CliError && error.message === "enable-help") {
      writeEnableHelp(writer, argvIncludesFlag(argv, "--json"));
      return ExitCode.SUCCESS;
    }

    const cliError = cliErrorFromUnknown(
      error,
      argvIncludesFlag(argv, "--debug") || argvIncludesFlag(argv, "-d")
    );
    writeCommandError(writer, commandForError, cliError, argvIncludesFlag(argv, "--json"));
    return cliError.exitCode;
  }
}

function runInitCommand(parsed: ParsedCli, writer: ReturnType<typeof createOutputWriter>): number {
  if (parsed.initArgs.length > 1) {
    throw new CliError(
      CliErrorCode.USAGE_ERROR,
      `Unexpected arguments: ${parsed.initArgs.slice(1).join(" ")}. Usage: atlas init [project]`
    );
  }

  const result = runInit({
    cwd: parsed.cwd,
    dryRun: parsed.dryRun,
    env: parsed.env,
    reference: parsed.reference,
    project: parsed.initArgs[0],
  });

  writeCommandSuccess(writer, "init", result, parsed.json, (value: CommandResult) =>
    formatInitResult(value, parsed.dryRun)
  );

  return ExitCode.SUCCESS;
}

function runEnableCliCommand(
  parsed: ParsedCli,
  writer: ReturnType<typeof createOutputWriter>
): number {
  const enableParsed = parseEnableArgs(parsed.enableArgs);
  enableParsed.cwd = enableParsed.cwd ?? parsed.cwd;
  enableParsed.dryRun = enableParsed.dryRun || parsed.dryRun;
  enableParsed.json = enableParsed.json || parsed.json;
  return runEnableCommand({ parsed: enableParsed, writer });
}

function runGenerateCliCommand(
  parsed: ParsedCli,
  writer: ReturnType<typeof createOutputWriter>
): number {
  if (parsed.generateArgs.length === 0) {
    writeGenerateHelp(writer, parsed.json);
    return ExitCode.SUCCESS;
  }

  const generateParsed = parseGenerateArgs(parsed.generateArgs);
  generateParsed.cwd = generateParsed.cwd ?? parsed.cwd;
  generateParsed.dryRun = generateParsed.dryRun || parsed.dryRun;
  generateParsed.json = generateParsed.json || parsed.json;

  return runGenerateCommand({
    parsed: generateParsed,
    writer,
  });
}

function runSyncCliCommand(
  parsed: ParsedCli,
  writer: ReturnType<typeof createOutputWriter>
): number {
  if (parsed.syncArgs.length === 0 || parsed.syncArgs[0] !== "infrastructure") {
    writeSyncHelp(writer, parsed.json);
    return ExitCode.SUCCESS;
  }

  if (parsed.syncArgs.length > 1) {
    throw new CliError(
      CliErrorCode.USAGE_ERROR,
      `Unexpected arguments: ${parsed.syncArgs.slice(1).join(" ")}`
    );
  }

  const result = runSyncInfrastructureCommand({
    cwd: parsed.cwd,
    dryRun: parsed.dryRun,
    check: parsed.check,
  });

  writeCommandSuccess(writer, "sync infrastructure", result, parsed.json, (value) =>
    formatSyncInfrastructureResult(value, parsed.dryRun || parsed.check)
  );

  return result.ok ? ExitCode.SUCCESS : ExitCode.DOCTOR_FAILED;
}

async function runUpgradeCliCommand(
  parsed: ParsedCli,
  writer: ReturnType<typeof createOutputWriter>
): Promise<number> {
  if (parsed.upgradeArgs.length > 0) {
    throw new CliError(
      CliErrorCode.USAGE_ERROR,
      `Unexpected arguments: ${parsed.upgradeArgs.join(" ")}`
    );
  }

  return runUpgradeCommand({
    cwd: parsed.cwd,
    targetVersion: parsed.targetVersion,
    dryRun: parsed.dryRun,
    allowDirty: parsed.allowDirty,
    merge: parsed.merge,
    skipValidation: parsed.skipValidation,
    releasesDir: parsed.releasesDir,
    json: parsed.json,
    writer,
  });
}

if (require.main === module) {
  void runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (isCliError(error)) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = error.exitCode;
        return;
      }

      process.stderr.write("Unexpected CLI failure.\n");
      process.exitCode = ExitCode.INTERNAL_ERROR;
    });
}
