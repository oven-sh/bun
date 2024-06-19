#! /usr/bin/env node

import {
  constants as fs,
  readFileSync,
  mkdtempSync,
  existsSync,
  statSync,
  mkdirSync,
  accessSync,
  appendFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir, hostname, userInfo, homedir } from "node:os";
import { join, basename, dirname, relative } from "node:path";
import { normalize as normalizeWindows } from "node:path/win32";

const spawnTimeout = 30_000;
const testTimeout = 3 * 60_000;
const integrationTimeout = 5 * 60_000;

const isLinux = process.platform === "linux";
const isMacOS = process.platform === "darwin";
const isWindows = process.platform === "win32";
const isGitHubAction = !!process.env["GITHUB_ACTIONS"];
const isBuildKite = !!process.env["BUILDKITE"];
const isBuildKiteTestSuite = !!process.env["BUILDKITE_ANALYTICS_TOKEN"];
const isCI = !!process.env["CI"] || isGitHubAction || isBuildKite;
const isInteractive = !isCI && process.argv.includes("-i") && process.stdout.isTTY;
const isBail = process.argv.includes("--bail");

const shardId = parseInt(process.env["BUILDKITE_PARALLEL_JOB"]) || 0;
const maxShards = parseInt(process.env["BUILDKITE_PARALLEL_JOB_COUNT"]) || 1;

const baseUrl = process.env["GITHUB_SERVER_URL"] || "https://github.com";
const repository = process.env["GITHUB_REPOSITORY"] || "oven-sh/bun";
const pullRequest = /^pull\/(\d+)$/.exec(process.env["GITHUB_REF"])?.[1];
const gitSha = getGitSha();
const gitRef = getGitRef();

const cwd = dirname(import.meta.dirname);
const testsPath = join(cwd, "test");
const tmpPath = getTmpdir();

function printInfo() {
  console.log("Timestamp:", new Date());
  console.log("OS:", getOsPrettyText(), getOsEmoji());
  console.log("Arch:", getArchText(), getArchEmoji());
  console.log("Hostname:", getHostname());
  if (isCI) {
    console.log("CI:", getCI());
    console.log("Shard:", shardId, "/", maxShards);
    console.log("Build URL:", getBuildUrl());
    console.log("Environment:", process.env);
  }
  console.log("Cwd:", cwd);
  console.log("Tmpdir:", tmpPath);
  console.log("Commit:", gitSha);
  console.log("Ref:", gitRef);
  if (pullRequest) {
    console.log("Pull Request:", pullRequest);
  }
}

/**
 * @param {string} target
 * @param {string[]} [filters]
 */
async function runTests(target, filters) {
  let execPath;
  if (isBuildKite && !existsSync(target)) {
    execPath = await getExecPathFromBuildKite(target);
  } else {
    execPath = getExecPath(target);
  }
  console.log("Bun:", execPath);

  const revision = getRevision(execPath);
  console.log("Revision:", revision);

  const tests = getTests(testsPath);
  let actualTests;
  if (filters?.length > 0) {
    actualTests = tests.filter(testPath => filters.some(filter => testPath.includes(filter)));
    console.log("Filtering tests:", actualTests.length, "/", tests.length);
  } else {
    const firstTest = shardId * Math.ceil(tests.length / maxShards);
    const lastTest = Math.min(firstTest + Math.ceil(tests.length / maxShards), tests.length);
    actualTests = tests.slice(firstTest, lastTest);
    console.log("Running tests:", firstTest, "...", lastTest, "/", tests.length);
  }

  const results = [];

  /**
   * @param {string} title
   * @param {function} fn
   */
  const runTest = async (title, fn) => {
    const result = await runTask(title, fn);
    if (isBail && !result.ok) {
      process.exit(1);
    }
    results.push(result);

    if (isBuildKite) {
      const { ok, testPath, error, stdout } = result;
      const logsPath = join(cwd, "logs", `${testPath}.log`);
      mkdirSync(dirname(logsPath), { recursive: true });
      appendFileSync(logsPath, stripAnsi(stdout));

      const markdown = formatTestToMarkdown(result);
      if (markdown) {
        reportAnnotationToBuildKite(title, markdown);
      }

      if (!ok) {
        const titleFailed = `${getAnsi("red")}${title} - ${error}${getAnsi("reset")}`;
        await runTask(titleFailed, () => {
          process.stderr.write(stdout);
        });
      }
    }

    if (isGitHubAction) {
      const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
      if (summaryPath) {
        const longMarkdown = formatTestToMarkdown(result);
        appendFileSync(summaryPath, longMarkdown);
      }
      const shortMarkdown = formatTestToMarkdown(result, true);
      appendFileSync("comment.md", shortMarkdown);
    }
  };

  for (const path of [cwd, testsPath]) {
    const title = relative(cwd, join(path, "package.json")).replace(/\\/g, "/");
    // await runTest(title, async () => spawnBunInstall(execPath, { cwd: path }));
  }

  if (results.every(({ ok }) => ok)) {
    for (const testPath of actualTests) {
      const title = relative(cwd, join(testsPath, testPath)).replace(/\\/g, "/");
      await runTest(title, async () => spawnBunTest(execPath, join("test", testPath)));
    }
  }

  const failedTests = results.filter(({ ok }) => !ok);
  if (isGitHubAction) {
    reportOutputToGitHubAction("failing_tests_count", failedTests.length);
    const markdown = formatTestToMarkdown(failedTests);
    reportOutputToGitHubAction("failing_tests", markdown);
  }

  return results;
}

/**
 * @typedef {object} SpawnOptions
 * @property {string} command
 * @property {string[]} [args]
 * @property {string} [cwd]
 * @property {number} [timeout]
 * @property {object} [env]
 * @property {function} [stdout]
 * @property {function} [stderr]
 */

/**
 * @typedef {object} SpawnResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {Error} [spawnError]
 * @property {number} [exitCode]
 * @property {number} [signalCode]
 * @property {number} timestamp
 * @property {number} duration
 * @property {string} stdout
 */

/**
 * @param {SpawnOptions} request
 * @returns {Promise<SpawnResult>}
 */
async function spawnSafe({
  command,
  args,
  cwd,
  env,
  timeout = spawnTimeout,
  stdout = process.stdout.write.bind(process.stdout),
  stderr = process.stderr.write.bind(process.stderr),
}) {
  let exitCode;
  let signalCode;
  let spawnError;
  let timestamp;
  let duration;
  let subprocess;
  let timer;
  let buffer = "";
  let doneCalls = 0;
  const beforeDone = resolve => {
    // TODO: wait for stderr as well, spawn.test currently causes it to hang
    if (doneCalls++ === 1) {
      done(resolve);
    }
  };
  const done = resolve => {
    if (timer) {
      clearTimeout(timer);
    }
    subprocess.stderr.unref();
    subprocess.stdout.unref();
    subprocess.unref();
    if (!signalCode && exitCode === undefined) {
      subprocess.stdout.destroy();
      subprocess.stderr.destroy();
      if (!subprocess.killed) {
        subprocess.kill(9);
      }
    }
    resolve();
  };
  await new Promise(resolve => {
    try {
      subprocess = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        cwd,
        env,
      });
      subprocess.on("spawn", () => {
        timestamp = Date.now();
        timer = setTimeout(() => done(resolve), timeout);
      });
      subprocess.on("error", error => {
        spawnError = error;
        done(resolve);
      });
      subprocess.on("exit", (code, signal) => {
        duration = Date.now() - timestamp;
        exitCode = code;
        signalCode = signal;
        if (signalCode || exitCode !== 0) {
          beforeDone(resolve);
        } else {
          done(resolve);
        }
      });
      subprocess.stdout.on("end", () => {
        beforeDone(resolve);
      });
      subprocess.stdout.on("data", chunk => {
        const text = chunk.toString("utf-8");
        stdout?.(text);
        buffer += text;
      });
      subprocess.stderr.on("data", chunk => {
        const text = chunk.toString("utf-8");
        stderr?.(text);
        buffer += text;
      });
    } catch (error) {
      spawnError = error;
      resolve();
    }
  });
  let error;
  if (spawnError) {
    const { message } = spawnError;
    if (/timed? ?out/.test(message)) {
      error = "timeout";
    } else {
      error = `error: ${message}`;
    }
  } else if (signalCode) {
    if (signalCode === "SIGTERM" && duration >= timeout) {
      error = "timeout";
    } else {
      error = signalCode;
    }
  } else if ((error = /thread \d+ panic: (.*)/.test(buffer))) {
    error = `panic: ${error[1]}`;
  } else if (exitCode === 1) {
    const match = buffer.match(/\x1b\[31m\s(\d+) fail/);
    if (match) {
      error = `${match[1]} failing`;
    } else {
      error = "code 1";
    }
  } else if (exitCode === undefined) {
    error = "timeout";
  } else if (exitCode !== 0) {
    if (isWindows) {
      const winCode = getWindowsExitCode(exitCode);
      if (winCode) {
        exitCode = winCode;
      }
    }
    error = `code ${exitCode}`;
  }
  return {
    ok: exitCode === 0 && !signalCode && !spawnError,
    error,
    exitCode,
    signalCode,
    spawnError,
    stdout: buffer,
    timestamp: timestamp || Date.now(),
    duration: duration || 0,
  };
}

/**
 * @param {string} execPath
 * @param {SpawnOptions} options
 * @returns {Promise<SpawnResult>}
 */
async function spawnBun(execPath, { args, cwd, timeout, env, stdout, stderr }) {
  const path = addPath(dirname(execPath), process.env.PATH);
  const tmpdirPath = mkdtempSync(join(tmpPath, "buntmp-"));
  const { username } = userInfo();
  const bunEnv = {
    ...process.env,
    PATH: path,
    TMPDIR: tmpdirPath,
    USER: username,
    HOME: homedir(),
    FORCE_COLOR: "1",
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    BUN_DEBUG_QUIET_LOGS: "1",
    BUN_GARBAGE_COLLECTOR_LEVEL: "1",
    BUN_ENABLE_CRASH_REPORTING: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    BUN_INSTALL_CACHE_DIR: tmpdirPath,
    SHELLOPTS: isWindows ? "igncr" : undefined, // ignore "\r" on Windows
  };
  if (env) {
    Object.assign(bunEnv, env);
  }
  // Use Linux namespaces to isolate the child process
  // https://man7.org/linux/man-pages/man1/unshare.1.html
  // if (isLinux) {
  //   const { uid, gid } = userInfo();
  //   args = [
  //     `--wd=${cwd}`,
  //     "--user",
  //     `--map-user=${uid}`,
  //     `--map-group=${gid}`,
  //     "--fork",
  //     "--kill-child",
  //     "--pid",
  //     execPath,
  //     ...args,
  //   ];
  //   execPath = "unshare";
  // }
  if (isWindows) {
    delete bunEnv["PATH"];
    bunEnv["Path"] = path;
    for (const tmpdir of ["TMPDIR", "TEMP", "TEMPDIR", "TMP"]) {
      delete bunEnv[tmpdir];
    }
    bunEnv["TEMP"] = tmpdirPath;
  }
  try {
    return await spawnSafe({
      command: execPath,
      args,
      cwd,
      timeout,
      env: bunEnv,
      stdout,
      stderr,
    });
  } finally {
    try {
      rmSync(tmpdirPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(error);
    }
  }
}

/**
 * @typedef {object} TestResult
 * @property {string} testPath
 * @property {boolean} ok
 * @property {string} status
 * @property {string} [error]
 * @property {TestEntry[]} tests
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {object} TestEntry
 * @property {string} [url]
 * @property {string} file
 * @property {string} test
 * @property {string} status
 * @property {TestError} [error]
 * @property {number} [duration]
 */

/**
 * @typedef {object} TestError
 * @property {string} [url]
 * @property {string} file
 * @property {number} line
 * @property {number} col
 * @property {string} name
 * @property {string} stack
 */

/**
 *
 * @param {string} execPath
 * @param {string} testPath
 * @returns {Promise<TestResult>}
 */
async function spawnBunTest(execPath, testPath) {
  const { ok, error, stdout } = await spawnBun(execPath, {
    args: ["test", testPath],
    cwd: cwd,
    timeout: getTestTimeout(testPath),
    env: {
      GITHUB_ACTIONS: "true", // always true so annotations are parsed
    },
    stdout: chunk => pipeTestStdout(process.stdout, chunk),
    stderr: chunk => pipeTestStdout(process.stderr, chunk),
  });
  const { tests, errors, stdout: testStdout } = parseTestStdout(stdout, testPath);
  return {
    testPath,
    ok,
    status: ok ? "pass" : "fail",
    error,
    errors,
    tests,
    stdout: testStdout,
  };
}

/**
 * @param {string} testPath
 * @returns {number}
 */
function getTestTimeout(testPath) {
  if (/integration|3rd_party|docker/i.test(testPath)) {
    return integrationTimeout;
  }
  return testTimeout;
}

/**
 * @param {NodeJS.WritableStream} io
 * @param {string} chunk
 */
function pipeTestStdout(io, chunk) {
  if (isGitHubAction) {
    io.write(chunk.replace(/\:\:(?:end)?group\:\:.*(?:\r\n|\r|\n)/gim, ""));
  } else {
    io.write(chunk.replace(/\:\:.*(?:\r\n|\r|\n)/gim, ""));
  }
}

/**
 * @typedef {object} TestOutput
 * @property {string} stdout
 * @property {TestResult[]} tests
 * @property {TestError[]} errors
 */

/**
 * @param {string} stdout
 * @param {string} [testPath]
 * @returns {TestOutput}
 */
function parseTestStdout(stdout, testPath) {
  const tests = [];
  const errors = [];

  let lines = [];
  let skipCount = 0;
  let testErrors = [];
  let done;
  for (const chunk of stdout.split("\n")) {
    const string = stripAnsi(chunk);

    if (!string.startsWith("::")) {
      lines.push(chunk);

      if (string.startsWith("✓") || string.startsWith("»") || string.startsWith("✎")) {
        skipCount++;
      } else {
        // If there are more than 3 consecutive non-failing tests,
        // omit the non-failing tests between them.
        if (skipCount > 3) {
          const removeStart = lines.length - skipCount;
          const removeCount = skipCount - 2;
          const omitLine = `${getAnsi("gray")}... omitted ${removeCount} tests ...${getAnsi("reset")}`;
          lines = lines.toSpliced(removeStart, removeCount, omitLine);
        }
        skipCount = 0;
      }
    }

    // Once the summary is printed, exit early so tests aren't double counted.
    // This needs to be changed if multiple files are run in a single test run.
    if (done || string.startsWith("::endgroup")) {
      done ||= true;
      continue;
    }

    if (string.startsWith("::error")) {
      const eol = string.indexOf("::", 8);
      const message = unescapeGitHubAction(string.substring(eol + 2));
      const { file, line, col, title } = Object.fromEntries(
        string
          .substring(8, eol)
          .split(",")
          .map(entry => entry.split("=")),
      );

      const errorPath = file || testPath;
      const error = {
        url: getFileUrl(errorPath, line),
        file: errorPath,
        line,
        col,
        name: title,
        stack: `${title}\n${message}`,
      };

      errors.push(error);
      testErrors.push(error);
      continue;
    }

    for (const { emoji, text } of [
      { emoji: "✓", text: "pass" },
      { emoji: "✗", text: "fail" },
      { emoji: "»", text: "skip" },
      { emoji: "✎", text: "todo" },
    ]) {
      if (!string.startsWith(emoji)) {
        continue;
      }

      const eol = string.lastIndexOf(" [") || undefined;
      const test = string.substring(1 + emoji.length, eol);
      const duration = eol ? string.substring(eol + 2, string.lastIndexOf("]")) : undefined;

      tests.push({
        url: getFileUrl(testPath),
        file: testPath,
        test,
        status: text,
        errors: testErrors,
        duration: parseDuration(duration),
      });

      for (let error of testErrors) {
        error.test = test;
      }
      testErrors = [];
    }
  }

  return {
    tests,
    errors,
    stdout: lines.join("\n"),
  };
}

/**
 * @param {string} execPath
 * @param {SpawnOptions} options
 * @returns {Promise<TestResult>}
 */
async function spawnBunInstall(execPath, options) {
  const { ok, error, stdout, duration } = await spawnBun(execPath, {
    args: ["install"],
    timeout: testTimeout,
    ...options,
  });
  const relativePath = relative(cwd, options.cwd);
  const testPath = join(relativePath, "package.json");
  const status = ok ? "pass" : "fail";
  return {
    testPath,
    ok,
    status,
    error,
    errors: [],
    tests: [
      {
        file: testPath,
        test: "bun install",
        status,
        duration: parseDuration(duration),
      },
    ],
    stdout,
  };
}

/**
 * @returns {string | undefined}
 */
function getGitSha() {
  const sha = process.env["GITHUB_SHA"] || process.env["BUILDKITE_COMMIT"];
  if (sha?.length === 40) {
    return sha;
  }
  try {
    const { stdout } = spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf-8",
      timeout: spawnTimeout,
    });
    return stdout.trim();
  } catch (error) {
    console.warn(error);
  }
}

/**
 * @returns {string}
 */
function getGitRef() {
  const ref = process.env["GITHUB_REF_NAME"] || process.env["BUILDKITE_BRANCH"];
  if (ref) {
    return ref;
  }
  try {
    const { stdout } = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
      timeout: spawnTimeout,
    });
    return stdout.trim();
  } catch (error) {
    console.warn(error);
    return "<unknown>";
  }
}

/**
 * @returns {string}
 */
function getTmpdir() {
  if (isWindows) {
    for (const key of ["TMPDIR", "TEMP", "TEMPDIR", "TMP", "RUNNER_TEMP"]) {
      const tmpdir = process.env[key] || "";
      if (!/^\/[a-z]\//i.test(tmpdir)) {
        continue;
      }
      // HACK: There are too many bugs with cygwin directories.
      // We should probably run Windows tests in both cygwin and powershell.
      if (/cygwin|cygdrive/i.test(tmpdir)) {
        continue;
      }
      const driveLetter = tmpdir[1];
      return normalizeWindows(`${driveLetter.toUpperCase()}:${tmpdir.substring(2)}`);
    }
    const appData = process.env["LOCALAPPDATA"];
    if (appData) {
      const appDataTemp = join(appData, "Temp");
      if (existsSync(appDataTemp)) {
        return appDataTemp;
      }
    }
  }
  if (isMacOS) {
    if (existsSync("/tmp")) {
      return "/tmp";
    }
  }
  return tmpdir();
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isJavaScript(path) {
  return /\.(c|m)?(j|t)sx?$/.test(basename(path));
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isTest(path) {
  return isJavaScript(path) && /\.test|spec\./.test(basename(path));
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isHidden(path) {
  return /node_modules|node.js/.test(dirname(path)) || /^\./.test(basename(path));
}

/**
 * @param {string} cwd
 * @returns {string[]}
 */
function getTests(cwd) {
  function* getFiles(cwd, path) {
    const dirname = join(cwd, path);
    for (const entry of readdirSync(dirname, { encoding: "utf-8", withFileTypes: true })) {
      const { name } = entry;
      const filename = join(path, name);
      if (isHidden(filename)) {
        continue;
      }
      if (entry.isFile() && isTest(filename)) {
        yield filename;
      } else if (entry.isDirectory()) {
        yield* getFiles(cwd, filename);
      }
    }
  }
  return [...getFiles(cwd, "")].sort();
}

let ntStatus;

/**
 * @param {number} exitCode
 * @returns {string}
 */
function getWindowsExitCode(exitCode) {
  if (ntStatus === undefined) {
    const ntStatusPath = "C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\shared\\ntstatus.h";
    try {
      ntStatus = readFileSync(ntStatusPath, "utf-8");
    } catch (error) {
      console.warn(error);
      ntStatus = "";
    }
  }

  const match = ntStatus.match(new RegExp(`(STATUS_\\w+).*0x${exitCode?.toString(16)}`, "i"));
  return match?.[1];
}

/**
 * @param {string} bunExe
 * @returns {string}
 */
function getExecPath(bunExe) {
  let execPath;
  let error;
  try {
    const { error, stdout } = spawnSync(bunExe, ["--print", "process.argv[0]"], {
      encoding: "utf-8",
      timeout: spawnTimeout,
      env: {
        PATH: process.env.PATH,
        BUN_DEBUG_QUIET_LOGS: 1,
      },
    });
    if (error) {
      throw error;
    }
    execPath = stdout.trim();
  } catch (cause) {
    error = cause;
  }

  if (execPath) {
    if (isExecutable(execPath)) {
      return execPath;
    }
    error = new Error(`File is not an executable: ${execPath}`);
  }

  throw new Error(`Could not find executable: ${bunExe}`, { cause: error });
}

/**
 * @param {string} target
 * @returns {Promise<string>}
 */
async function getExecPathFromBuildKite(target) {
  const releasePath = join(cwd, "release");
  mkdirSync(releasePath, { recursive: true });
  await spawnSafe({
    command: "buildkite-agent",
    args: ["artifact", "download", "**", releasePath, "--step", target],
  });

  const zipPath = join(releasePath, `${target}.zip`);
  if (isWindows) {
    await spawnSafe({
      command: "powershell",
      args: ["-Command", `Expand-Archive -Path ${zipPath} -DestinationPath ${releasePath}`],
    });
  } else {
    await spawnSafe({
      command: "unzip",
      args: ["-o", zipPath, "-d", releasePath],
    });
  }

  const execPath = join(releasePath, target, isWindows ? "bun.exe" : "bun");
  if (!isExecutable(execPath)) {
    throw new Error(`Could not find executable from BuildKite: ${execPath}`);
  }

  return execPath;
}

/**
 * @param {string} execPath
 * @returns {string}
 */
function getRevision(execPath) {
  try {
    const { error, stdout } = spawnSync(execPath, ["--revision"], {
      encoding: "utf-8",
      timeout: spawnTimeout,
      env: {
        PATH: process.env.PATH,
        BUN_DEBUG_QUIET_LOGS: 1,
      },
    });
    if (error) {
      throw error;
    }
    return stdout.trim();
  } catch (error) {
    console.warn(error);
    return "<unknown>";
  }
}

/**
 * @returns {string}
 */
function getOsText() {
  const { platform } = process;
  switch (platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return platform;
  }
}

/**
 * @returns {string}
 */
function getOsPrettyText() {
  const { platform } = process;
  if (platform === "darwin") {
    const properties = {};
    for (const property of ["productName", "productVersion", "buildVersion"]) {
      try {
        const { error, stdout } = spawnSync("sw_vers", [`-${property}`], {
          encoding: "utf-8",
          timeout: spawnTimeout,
          env: {
            PATH: process.env.PATH,
          },
        });
        if (error) {
          throw error;
        }
        properties[property] = stdout.trim();
      } catch (error) {
        console.warn(error);
      }
    }
    const { productName, productVersion, buildVersion } = properties;
    if (!productName) {
      return "macOS";
    }
    if (!productVersion) {
      return productName;
    }
    if (!buildVersion) {
      return `${productName} ${productVersion}`;
    }
    return `${productName} ${productVersion} (build: ${buildVersion})`;
  }
  if (platform === "linux") {
    try {
      const { error, stdout } = spawnSync("lsb_release", ["--description", "--short"], {
        encoding: "utf-8",
        timeout: spawnTimeout,
        env: {
          PATH: process.env.PATH,
        },
      });
      if (error) {
        throw error;
      }
      return stdout.trim();
    } catch (error) {
      console.warn(error);
      return "Linux";
    }
  }
  if (platform === "win32") {
    try {
      const { error, stdout } = spawnSync("cmd", ["/c", "ver"], {
        encoding: "utf-8",
        timeout: spawnTimeout,
        env: {
          PATH: process.env.PATH,
        },
      });
      if (error) {
        throw error;
      }
      return stdout.trim();
    } catch (error) {
      console.warn(error);
      return "Windows";
    }
  }
  return platform;
}

/**
 * @returns {string}
 */
function getOsEmoji() {
  const { platform } = process;
  switch (platform) {
    case "darwin":
      return isBuildKite ? ":apple:" : "";
    case "win32":
      return isBuildKite ? ":windows:" : "🪟";
    case "linux":
      return isBuildKite ? ":linux:" : "🐧";
    default:
      return "🔮";
  }
}

/**
 * @returns {string}
 */
function getArchText() {
  const { arch } = process;
  switch (arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "aarch64";
    default:
      return arch;
  }
}

/**
 * @returns {string}
 */
function getArchEmoji() {
  const { arch } = process;
  switch (arch) {
    case "x64":
      return "🖥";
    case "arm64":
      return "💪";
    default:
      return "🔮";
  }
}

/**
 * @returns {string | undefined}
 */
function getBuildUrl() {
  if (isBuildKite) {
    const buildUrl = process.env["BUILDKITE_BUILD_URL"];
    const jobId = process.env["BUILDKITE_JOB_ID"];
    if (buildUrl) {
      return jobId ? `${buildUrl}#${jobId}` : buildUrl;
    }
  }
  if (isGitHubAction) {
    const baseUrl = process.env["GITHUB_SERVER_URL"];
    const repository = process.env["GITHUB_REPOSITORY"];
    const runId = process.env["GITHUB_RUN_ID"];
    if (baseUrl && repository && runId) {
      return `${baseUrl}/${repository}/actions/runs/${runId}`;
    }
  }
}

/**
 * @returns {string}
 */
function getBuildLabel() {
  if (isBuildKite) {
    return process.env["BUILDKITE_GROUP_LABEL"] || process.env["BUILDKITE_LABEL"];
  }
  return `${getOsEmoji()} ${getArchText()}`;
}

/**
 * @param {string} file
 * @param {number} [line]
 * @returns {string | undefined}
 */
function getFileUrl(file, line) {
  const filePath = file.replace(/\\/g, "/");

  let url;
  if (pullRequest) {
    const fileMd5 = crypto.createHash("md5").update(filePath).digest("hex");
    url = `${baseUrl}/${repository}/pull/${pullRequest}/files#diff-${fileMd5}`;
    if (line !== undefined) {
      url += `L${line}`;
    }
  } else if (gitSha) {
    url = `${baseUrl}/${repository}/blob/${gitSha}/${filePath}`;
    if (line !== undefined) {
      url += `#L${line}`;
    }
  }

  return url;
}

/**
 * @returns {string | undefined}
 */
function getCI() {
  if (isBuildKite) {
    return "BuildKite";
  }
  if (isGitHubAction) {
    return "GitHub Actions";
  }
  if (isCI) {
    return "CI";
  }
}

/**
 * @returns {string | undefined}
 */
function getHostname() {
  if (isBuildKite) {
    return process.env["BUILDKITE_AGENT_NAME"];
  }
  try {
    return hostname();
  } catch (error) {
    console.warn(error);
  }
}

/**
 * @param  {...string} paths
 * @returns {string}
 */
function addPath(...paths) {
  if (isWindows) {
    return paths.join(";");
  }
  return paths.join(":");
}

/**
 * @param {string} title
 * @param {function} fn
 */
async function runTask(title, fn) {
  if (isGitHubAction) {
    console.log(`::group::${stripAnsi(title)}`);
  } else if (isBuildKite) {
    console.log(`--- ${title}`);
  } else {
    console.log(title);
  }
  try {
    return await fn();
  } finally {
    if (isGitHubAction) {
      console.log("::endgroup::");
    }
    console.log();
  }
}

/**
 * @param  {TestResult | TestResult[]} result
 * @param  {boolean} concise
 * @returns {string}
 */
function formatTestToMarkdown(result, concise) {
  const results = Array.isArray(result) ? result : [result];
  const buildLabel = getBuildLabel();
  const buildUrl = getBuildUrl();
  const platform = buildUrl ? `<a href="${buildUrl}">${buildLabel}</a>` : buildLabel;

  let markdown = "";
  for (const { testPath, ok, tests, error, stdout } of results) {
    if (ok) {
      continue;
    }

    let errorLine;
    for (const { error } of tests) {
      if (!error) {
        continue;
      }
      const { file, line } = error;
      if (line) {
        errorLine = line;
        break;
      }
    }

    const testTitle = testPath.replace(/\\/g, "/");
    const testUrl = getFileUrl(testPath, errorLine);

    if (concise) {
      markdown += "<li>";
    } else {
      markdown += "<details><summary>";
    }

    if (testUrl) {
      markdown += `<a href="${testUrl}"><code>${testTitle}</code></a>`;
    } else {
      markdown += `<a><code>${testTitle}</code></a>`;
    }
    if (error) {
      markdown += ` - ${error}`;
    }
    markdown += ` on ${platform}`;

    if (concise) {
      markdown += "</li>\n";
    } else {
      markdown += "</summary>\n\n";
      if (isBuildKite) {
        const preview = escapeCodeBlock(stdout);
        markdown += `\`\`\`terminal\n${preview}\n\`\`\`\n`;
      } else {
        const preview = escapeHtml(stripAnsi(stdout));
        markdown += `<pre><code>${preview}</code></pre>\n`;
      }
      markdown += "\n\n</details>\n\n";
    }
  }

  return markdown;
}

/**
 * @param {string} label
 * @param {string} content
 * @param {number | undefined} attempt
 */
function reportAnnotationToBuildKite(label, content, attempt = 0) {
  const { error, status, signal, stderr } = spawnSync(
    "buildkite-agent",
    ["annotate", "--append", "--style", "error", "--context", `${label}`, "--priority", `${attempt}`],
    {
      input: content,
      stdio: ["pipe", "ignore", "pipe"],
      encoding: "utf-8",
      timeout: spawnTimeout,
      cwd,
    },
  );
  if (status === 0) {
    return;
  }
  const cause = error ?? signal ?? `code ${status}`;
  if (attempt > 0) {
    throw new Error(`Failed to create annotation: ${label}`, { cause });
  }
  let message = `Failed to create annotation for \`${label}\`: ${cause}`;
  if (stderr) {
    message += `\n\`\`\`terminal\n${escapeCodeBlock(stderr)}\n\`\`\``;
  }
  reportAnnotationToBuildKite(`${label}-error`, message, attempt + 1);
}

/**
 * @param {string} name
 * @param {string} value
 */
function reportOutputToGitHubAction(name, value) {
  const outputPath = process.env["GITHUB_OUTPUT"];
  if (!outputPath) {
    return;
  }
  const delimeter = Math.random().toString(36).substring(2, 15);
  const content = `${name}<<${delimeter}\n${value}\n${delimeter}\n`;
  appendFileSync(outputPath, content);
}

/**
 * @param {string} color
 * @returns {string}
 */
function getAnsi(color) {
  switch (color) {
    case "red":
      return "\x1b[31m";
    case "green":
      return "\x1b[32m";
    case "yellow":
      return "\x1b[33m";
    case "blue":
      return "\x1b[34m";
    case "reset":
      return "\x1b[0m";
    case "gray":
      return "\x1b[90m";
    default:
      return "";
  }
}

/**
 * @param {string} string
 * @returns {string}
 */
function stripAnsi(string) {
  return string.replace(/\u001b\[\d+m/g, "");
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeGitHubAction(string) {
  return string.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * @param {string} string
 * @returns {string}
 */
function unescapeGitHubAction(string) {
  return string.replace(/%25/g, "%").replace(/%0D/g, "\r").replace(/%0A/g, "\n");
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeHtml(string) {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeCodeBlock(string) {
  return string.replace(/`/g, "\\`");
}

/**
 * @param {string} string
 * @returns {number | undefined}
 */
function parseDuration(duration) {
  const match = /(\d+\.\d+)(m?s)/.exec(duration);
  if (!match) {
    return undefined;
  }
  const [, value, unit] = match;
  return parseFloat(value) * (unit === "ms" ? 1 : 1000);
}

/**
 * @param {string} status
 * @returns {string}
 */
function getTestEmoji(status) {
  switch (status) {
    case "pass":
      return "✅";
    case "fail":
      return "❌";
    case "skip":
      return "⏭";
    case "todo":
      return "✏️";
    default:
      return "🔮";
  }
}

/**
 * @param {string} status
 * @returns {string}
 */
function getTestColor(status) {
  switch (status) {
    case "pass":
      return getAnsi("green");
    case "fail":
      return getAnsi("red");
    case "skip":
    case "todo":
    default:
      return getAnsi("gray");
  }
}

/**
 * @param {string} execPath
 * @returns {boolean}
 */
function isExecutable(execPath) {
  if (!existsSync(execPath) || !statSync(execPath).isFile()) {
    return false;
  }
  try {
    accessSync(execPath, fs.X_OK);
  } catch {
    return false;
  }
  return true;
}

const [target, ...filters] = process.argv.slice(2);
if (!target) {
  const filename = relative(cwd, import.meta.filename);
  throw new Error(`Usage: ${process.argv0} ${filename} <target> [...filters]`);
}

runTask("Environment", printInfo);
const results = await runTests(target, filters);
const ok = results.every(({ ok }) => ok);
if (isBuildKite) {
  process.exit(ok ? 0 : 2);
} else {
  process.exit(ok ? 0 : 1);
}
