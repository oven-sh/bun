import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import readline from "node:readline/promises";

const testPath = new URL("./", import.meta.url);
const nodePath = new URL("upstream/", testPath);
const nodeTestPath = new URL("test/", nodePath);
const metadataScriptPath = new URL("metadata.mjs", testPath);
const testJsonPath = new URL("tests.json", testPath);
const summariesPath = new URL("summary/", testPath);
const summaryMdPath = new URL("summary.md", testPath);
const cwd = new URL("../../", testPath);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: {
        type: "boolean",
        short: "h",
      },
      baseline: {
        type: "boolean",
      },
      interactive: {
        type: "boolean",
        short: "i",
      },
      "exec-path": {
        type: "string",
      },
      pull: {
        type: "boolean",
      },
      summary: {
        type: "boolean",
      },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (values.summary) {
    printSummary();
    return;
  }

  if (values.pull) {
    pullTests(true);
    return;
  }

  pullTests();
  const summary = await runTests(values, positionals);
  const regressedTests = appendSummary(summary);
  printSummary(summary, regressedTests);

  process.exit(regressedTests?.length ? 1 : 0);
}

function printHelp() {
  console.log(`Usage: ${process.argv0} ${basename(import.meta.filename)} [options]`);
  console.log();
  console.log("Options:");
  console.log("  -h, --help        Show this help message");
  console.log("  -e, --exec-path   Path to the bun executable to run");
  console.log("  -i, --interactive Pause and wait for input after a failing test");
  console.log("  -s, --summary     Print a summary of the tests (does not run tests)");
}

function pullTests(force) {
  if (!force && existsSync(nodeTestPath)) {
    return;
  }

  console.log("Pulling tests...");
  const { status, error, stderr } = spawnSync(
    "git",
    ["submodule", "update", "--init", "--recursive", "--progress", "--depth=1", "--checkout", "upstream"],
    {
      cwd: testPath,
      stdio: "inherit",
    },
  );

  if (error || status !== 0) {
    throw error || new Error(stderr);
  }

  for (const { filename, status } of getTests(nodeTestPath)) {
    if (status === "TODO") {
      continue;
    }

    const src = new URL(filename, nodeTestPath);
    const dst = new URL(filename, testPath);

    try {
      writeFileSync(dst, readFileSync(src));
    } catch (error) {
      if (error.code === "ENOENT") {
        mkdirSync(new URL(".", dst), { recursive: true });
        writeFileSync(dst, readFileSync(src));
      } else {
        throw error;
      }
    }
  }
}

async function runTests(options, filters) {
  const { interactive } = options;
  const bunPath = process.isBun ? process.execPath : "bun";
  const execPath = options["exec-path"] || bunPath;

  let reader;
  if (interactive) {
    reader = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  const results = [];
  const tests = getTests(testPath);
  for (const { label, filename, status: filter } of tests) {
    if (filters?.length && !filters.some(filter => label?.includes(filter))) {
      continue;
    }

    if (filter !== "OK") {
      results.push({ label, filename, status: filter });
      continue;
    }

    const { pathname: filePath } = new URL(filename, testPath);
    const tmp = tmpdirSync();
    const timestamp = Date.now();
    const {
      status: exitCode,
      signal: signalCode,
      error: spawnError,
    } = spawnSync(execPath, ["test", filePath], {
      cwd: testPath,
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        HOME: tmp,
        TMPDIR: tmp,
        TZ: "Etc/UTC",
        FORCE_COLOR: "1",
        BUN_DEBUG_QUIET_LOGS: "1",
        BUN_GARBAGE_COLLECTOR_LEVEL: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        GITHUB_ACTIONS: "false", // disable for now
      },
      timeout: 30_000,
    });

    const duration = Math.ceil(Date.now() - timestamp);
    const status = exitCode === 0 ? "PASS" : "FAIL";
    let error;
    if (signalCode) {
      error = signalCode;
    } else if (spawnError) {
      const { message } = spawnError;
      if (message.includes("timed out") || message.includes("timeout")) {
        error = "TIMEOUT";
      } else {
        error = message;
      }
    } else if (exitCode !== 0) {
      error = `code ${exitCode}`;
    }
    results.push({ label, filename, status, error, timestamp, duration });

    if (reader && status === "FAIL") {
      const answer = await reader.question("Continue? [Y/n] ");
      if (answer.toUpperCase() !== "Y") {
        break;
      }
    }
  }

  reader?.close();
  return {
    v: 1,
    metadata: getMetadata(execPath),
    tests: results,
  };
}

function getTests(filePath) {
  const tests = [];
  const testData = JSON.parse(readFileSync(testJsonPath, "utf8"));

  for (const filename of readdirSync(filePath, { recursive: true })) {
    if (!isJavaScript(filename) || !isTest(filename)) {
      continue;
    }

    let match;
    for (const { label, pattern, skip: skipList = [], todo: todoList = [] } of testData) {
      if (!filename.startsWith(pattern)) {
        continue;
      }

      if (skipList.some(({ file }) => filename.endsWith(file))) {
        tests.push({ label, filename, status: "SKIP" });
      } else if (todoList.some(({ file }) => filename.endsWith(file))) {
        tests.push({ label, filename, status: "TODO" });
      } else {
        tests.push({ label, filename, status: "OK" });
      }

      match = true;
      break;
    }

    if (!match) {
      tests.push({ filename, status: "TODO" });
    }
  }

  return tests;
}

function appendSummary(summary) {
  const { metadata, tests, ...extra } = summary;
  const { name } = metadata;

  const summaryPath = new URL(`${name}.json`, summariesPath);
  const summaryData = {
    metadata,
    tests: tests.map(({ label, filename, status, error }) => ({ label, filename, status, error })),
    ...extra,
  };

  const regressedTests = [];
  if (existsSync(summaryPath)) {
    const previousData = JSON.parse(readFileSync(summaryPath, "utf8"));
    const { v } = previousData;
    if (v === 1) {
      const { tests: previousTests } = previousData;
      for (const { label, filename, status, error } of tests) {
        if (status !== "FAIL") {
          continue;
        }
        const previousTest = previousTests.find(({ filename: file }) => file === filename);
        if (previousTest) {
          const { status: previousStatus } = previousTest;
          if (previousStatus !== "FAIL") {
            regressedTests.push({ label, filename, error });
          }
        }
      }
    }
  }

  if (regressedTests.length) {
    return regressedTests;
  }

  const summaryText = JSON.stringify(summaryData, null, 2);
  try {
    writeFileSync(summaryPath, summaryText);
  } catch (error) {
    if (error.code === "ENOENT") {
      mkdirSync(summariesPath, { recursive: true });
      writeFileSync(summaryPath, summaryText);
    } else {
      throw error;
    }
  }
}

function printSummary(summaryData, regressedTests) {
  let metadataInfo = {};
  let testInfo = {};
  let labelInfo = {};
  let errorInfo = {};

  const summaryList = [];
  if (summaryData) {
    summaryList.push(summaryData);
  } else {
    for (const filename of readdirSync(summariesPath)) {
      if (!filename.endsWith(".json")) {
        continue;
      }

      const summaryPath = new URL(filename, summariesPath);
      const summaryData = JSON.parse(readFileSync(summaryPath, "utf8"));
      summaryList.push(summaryData);
    }
  }

  for (const summaryData of summaryList) {
    const { v, metadata, tests } = summaryData;
    if (v !== 1) {
      continue;
    }

    const { name, version, revision } = metadata;
    if (revision) {
      metadataInfo[name] =
        `${version}-[\`${revision.slice(0, 7)}\`](https://github.com/oven-sh/bun/commit/${revision})`;
    } else {
      metadataInfo[name] = `${version}`;
    }

    for (const test of tests) {
      const { label, filename, status, error } = test;
      if (label) {
        labelInfo[label] ||= { pass: 0, fail: 0, skip: 0, todo: 0, total: 0 };
        labelInfo[label][status.toLowerCase()] += 1;
        labelInfo[label].total += 1;
      }
      testInfo[name] ||= { pass: 0, fail: 0, skip: 0, todo: 0, total: 0 };
      testInfo[name][status.toLowerCase()] += 1;
      testInfo[name].total += 1;
      if (status === "FAIL") {
        errorInfo[filename] ||= {};
        errorInfo[filename][name] = error;
      }
    }
  }

  let summaryMd = `## Node.js tests
`;

  if (!summaryData) {
    summaryMd += `
| Platform | Conformance | Passed | Failed | Skipped | Total |
| - | - | - | - | - | - |
`;

    for (const [name, { pass, fail, skip, total }] of Object.entries(testInfo)) {
      testInfo[name].coverage = (((pass + fail + skip) / total) * 100).toFixed(2);
      testInfo[name].conformance = ((pass / total) * 100).toFixed(2);
    }

    for (const [name, { conformance, pass, fail, skip, total }] of Object.entries(testInfo)) {
      summaryMd += `| \`${name}\` ${metadataInfo[name]} | ${conformance} % | ${pass} | ${fail} | ${skip} | ${total} |\n`;
    }
  }

  summaryMd += `
| API | Conformance | Passed | Failed | Skipped | Total |
| - | - | - | - | - | - |
`;

  for (const [label, { pass, fail, skip, total }] of Object.entries(labelInfo)) {
    labelInfo[label].coverage = (((pass + fail + skip) / total) * 100).toFixed(2);
    labelInfo[label].conformance = ((pass / total) * 100).toFixed(2);
  }

  for (const [label, { conformance, pass, fail, skip, total }] of Object.entries(labelInfo)) {
    summaryMd += `| \`${label}\` | ${conformance} % | ${pass} | ${fail} | ${skip} | ${total} |\n`;
  }

  if (!summaryData) {
    writeFileSync(summaryMdPath, summaryMd);
  }

  const githubSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (githubSummaryPath) {
    appendFileSync(githubSummaryPath, summaryMd);
  }

  console.log("=".repeat(process.stdout.columns));
  console.log("Summary by platform:");
  console.table(testInfo);
  console.log("Summary by label:");
  console.table(labelInfo);
  if (regressedTests?.length) {
    const isTty = process.stdout.isTTY;
    if (isTty) {
      process.stdout.write("\x1b[31m");
    }
    const { name } = summaryData.metadata;
    console.log(`Regressions found in ${regressedTests.length} tests for ${name}:`);
    console.table(regressedTests);
    if (isTty) {
      process.stdout.write("\x1b[0m");
    }
  }
}

function isJavaScript(filename) {
  return /\.(m|c)?js$/.test(filename);
}

function isTest(filename) {
  return /^test-/.test(basename(filename));
}

function getMetadata(execPath) {
  const { pathname: filePath } = metadataScriptPath;
  const { status: exitCode, stdout } = spawnSync(execPath, [filePath], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      PATH: process.env.PATH,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
    timeout: 5_000,
  });

  if (exitCode === 0) {
    try {
      return JSON.parse(stdout);
    } catch {
      // Ignore
    }
  }

  return {
    os: process.platform,
    arch: process.arch,
  };
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
