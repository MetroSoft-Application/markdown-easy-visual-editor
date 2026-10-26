#!/usr/bin/env node
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { applyRules } from "../lib/core.mjs";

function usage() {
  return [
    "mve-output-filter - regex-based text replacement for CI/CD and export pipelines",
    "",
    "Usage:",
    "  mve-output-filter <input> --config <file> [--output <file>]",
    "  mve-output-filter <input> --config <file> --in-place",
    "  mve-output-filter - --config <file> > output.md",
    "  mve-output-filter <input> --config <file> --check",
    "",
    "Options:",
    "  -c, --config <file>   JSON config file",
    "  -o, --output <file>   Write transformed text to file",
    "      --in-place        Replace the input file atomically",
    "      --check           Do not write; exit 1 when transformation would change input",
    "      --report-json     Write machine-readable match report to stderr",
    "  -h, --help            Show this help",
    "",
    "Input '-' reads UTF-8 text from stdin.",
  ].join("\n");
}

function parseArgs(argv) {
  let input;
  let configPath;
  let outputPath;
  let inPlace = false;
  let check = false;
  let reportJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "-h":
      case "--help":
        return { help: true };
      case "-c":
      case "--config":
        configPath = argv[++index];
        if (!configPath) throw new Error(`${arg} requires a file path.`);
        break;
      case "-o":
      case "--output":
        outputPath = argv[++index];
        if (!outputPath) throw new Error(`${arg} requires a file path.`);
        break;
      case "--in-place":
        inPlace = true;
        break;
      case "--check":
        check = true;
        break;
      case "--report-json":
        reportJson = true;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (input !== undefined) {
          throw new Error("Only one input file is supported per invocation.");
        }
        input = arg;
    }
  }

  if (!configPath) throw new Error("--config is required.");
  if (input === undefined) input = "-";
  if (inPlace && input === "-") throw new Error("--in-place cannot be used with stdin.");
  if (inPlace && outputPath) throw new Error("--in-place and --output cannot be used together.");
  if (check && (inPlace || outputPath)) {
    throw new Error("--check cannot be combined with --in-place or --output.");
  }

  return { input, configPath, outputPath, inPlace, check, reportJson, help: false };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readConfig(path) {
  let raw;
  try {
    raw = await readFile(resolve(path), "utf8");
  } catch (error) {
    throw new Error(`Unable to read config "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in config "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function atomicWrite(path, content) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.mve-output-filter-${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function writeReport(result, sourceLabel) {
  const payload = {
    input: sourceLabel,
    changed: result.changed,
    totalMatches: result.totalMatches,
    rules: result.rules,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`mve-output-filter: ${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  try {
    const config = await readConfig(options.configPath);
    const input =
      options.input === "-"
        ? await readStdin()
        : await readFile(resolve(options.input), "utf8");

    const result = applyRules(input, config);

    if (options.reportJson) writeReport(result, options.input);

    if (options.check) {
      if (!options.reportJson) {
        process.stderr.write(
          `mve-output-filter: ${result.totalMatches} match(es); changed=${result.changed}\n`,
        );
      }
      process.exitCode = result.changed ? 1 : 0;
      return;
    }

    if (options.inPlace) {
      if (result.changed) await atomicWrite(options.input, result.text);
      return;
    }

    if (options.outputPath) {
      await atomicWrite(options.outputPath, result.text);
      return;
    }

    process.stdout.write(result.text);
  } catch (error) {
    process.stderr.write(
      `mve-output-filter: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}

await main();
