import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isHardened } from "../../aot/hardened";
import { withoutCoreDump } from "../../aot/harness/without-core-dump";

// A `telemetry` in bunfig.toml that is not `true` stops the crash handler from uploading a report, in every command
// that reads the file. `telemetry = true` turns nothing back on.

// What the machine that runs the tests has set must not decide the answer.
const env = { ...bunEnv, DO_NOT_TRACK: undefined, HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET: undefined };

// Debug and ASAN builds never upload a report. A binding says what the crash handler would be told.
const says = `"<telemetry:" + crash_handler.isAnalyticsEnabled() + ">"`;
const told = ({ stdout, stderr }: Result) => /<telemetry:(\w+)>/.exec(stdout + stderr)?.[1] ?? stderr;

// `bun lint` runs a plugin in its own process.
const lintsWithPlugin = `[lint]\nplugins = ["./plugin.cjs"]\n[lint.rules]\n"says/nothing" = "warn"\n`;
const files = {
  "telemetry.js": `import { crash_handler } from "bun:internal-for-testing";\nexport const telemetry = () => ${says};\n`,
  "a.js": `import { telemetry } from "./telemetry.js";\nconsole.log(telemetry());\n`,
  "a.test.js": `import { test } from "bun:test";\nimport { telemetry } from "./telemetry.js";\ntest("says it", () => console.log(telemetry()));\n`,
  "build.js": `import { telemetry } from "./telemetry.js" with { type: "macro" };\nconsole.log(telemetry());\n`,
  "plugin.cjs": `const { crash_handler } = require("bun:internal-for-testing");\nconsole.error(${says});\nmodule.exports = { meta: { name: "says" }, rules: { nothing: { create: () => ({}) } } };\n`,
  "below/clean.js": `export const a = 1;\n`,
  // `bun fmt` reads this file in a second process, which reads no bunfig.toml.
  "prettier/prettier.config.js": `import { crash_handler } from "bun:internal-for-testing";\nthrow new Error(${says});\n`,
  "prettier/clean.js": `export const a = 1;\n`,
  "prettier/package.json": JSON.stringify({ name: "bunfig-telemetry-prettier", type: "module" }),
  "fault.js": `import { read } from "bun:ffi";\nexport const crash = () => read.u8(8);\n`,
  "crash.js": `import { crash } from "./fault.js";\ncrash();\n`,
  "crash.test.js": `import { test } from "bun:test";\nimport { crash } from "./fault.js";\ntest("crashes", () => crash());\n`,
  "crash-build.js": `import { crash } from "./fault.js" with { type: "macro" };\nconsole.log(crash());\n`,
  "package.json": JSON.stringify({ name: "bunfig-telemetry" }),
  // Stands first on PATH in place of the program that uploads a report, and uploads nothing.
  "bin/curl": `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CALLS"\necho "uploader ran" >&2\n`,
};
const project = (telemetry?: string) =>
  tempDir(
    "bunfig-telemetry",
    telemetry === undefined
      ? files
      : { ...files, "bunfig.toml": telemetry + lintsWithPlugin, "prettier/bunfig.toml": telemetry },
  );

async function run(cwd: string, cmd: string[], vars: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({ cmd, env: { ...env, ...vars }, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
type Result = Awaited<ReturnType<typeof run>>;

// The tests below that read the binding run one at a time. Under a debug build each of them takes about a second, and
// run together they pass the default timeout.

describe("`telemetry = false` turns the upload off", () => {
  const commands: [name: string, command: string[], cwd?: string][] = [
    ["bun <file>", ["a.js"]],
    ["bun run <file>", ["run", "a.js"]],
    ["bun test", ["test", "a.test.js"]],
    ["bun as node --config=bunfig.toml", ["--bun", "node", "--config=bunfig.toml", "a.js"]],
    ["bun lint", ["lint", "a.js"]],
    ["bun lint, in a directory below the file", ["lint", "clean.js"], "below"],
    ["bun fmt, in the process that reads prettier.config.js", ["fmt", "clean.js"], "prettier"],
  ];
  test.each(commands)("for %s", async (_, command, cwd = "") => {
    using dir = project("telemetry = false\n");
    expect(told(await run(join(String(dir), cwd), [bunExe(), ...command]))).toBe("false");
  });

  // A macro reaches the binding only in a debug build. The crash handler tests below cover the other builds.
  test.skipIf(!isDebug)("for bun build", async () => {
    using dir = project("telemetry = false\n");
    expect(told(await run(String(dir), [bunExe(), "build", "build.js"]))).toBe("false");
  });
});

describe("any one opt-out is enough, and `telemetry = true` is none", () => {
  const [asked, hyperfine] = ["telemetry = true\n", { HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET: "1" }];
  const settings: [name: string, bunfig: string | undefined, vars: Record<string, string>, telemetry: string][] = [
    ["nothing set", undefined, {}, "true"],
    ["telemetry = true", asked, {}, "true"],
    ["DO_NOT_TRACK=1", undefined, { DO_NOT_TRACK: "1" }, "false"],
    ["telemetry = true and DO_NOT_TRACK=1", asked, { DO_NOT_TRACK: "1" }, "false"],
    ["HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET=1", undefined, hyperfine, "false"],
    ["telemetry = true and HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET=1", asked, hyperfine, "false"],
  ];
  test.each(settings)("%s", async (_, bunfig, vars, telemetry) => {
    using dir = project(bunfig);
    const result = await run(String(dir), [bunExe(), "a.js"], vars);
    expect({ telemetry: told(result), exitCode: result.exitCode }).toEqual({ telemetry, exitCode: 0 });
  });
});

describe("a `telemetry` that is not a boolean", () => {
  const notBooleans = ['telemetry = "no"\n', "[telemetry]\nenabled = false\n"];

  // Only `bun <file>` and `bun run` check the type of the key.
  test.each(notBooleans)("turns the upload off for bun test, and is no error there: %j", async bunfig => {
    using dir = project(bunfig);
    const result = await run(String(dir), [bunExe(), "test", "a.test.js"]);
    expect({ telemetry: told(result), exitCode: result.exitCode }).toEqual({ telemetry: "false", exitCode: 0 });
    expect(result.stderr).not.toContain("expected boolean");
  });

  test("turns the upload off for bun lint in a directory below the file, and is no error there", async () => {
    using dir = project(notBooleans[0]);
    const result = await run(join(String(dir), "below"), [bunExe(), "lint", "clean.js"]);
    expect({ telemetry: told(result), exitCode: result.exitCode }).toEqual({ telemetry: "false", exitCode: 0 });
    expect(result.stderr).not.toContain("expected boolean");
  });
});

// `bun run <file>` prints what is wrong with a bunfig.toml and runs the file. Whether it runs the file or not, it
// does not do so with the upload on.
test.each(['telemetry = "no"\n', "logLevel = 3\ntelemetry = false\n"])(
  "bun run does not go on with the upload on after a bunfig.toml that fails to load: %j",
  async bunfig => {
    using dir = project(bunfig);
    const result = await run(String(dir), [bunExe(), "run", "a.js"]);
    expect(result.stderr).toContain("error: expected");
    expect(told(result)).not.toBe("true");
  },
);

// Only a build that uploads reports without being asked gets as far as the setting: a canary build, and a release for
// macOS. On Windows the program that uploads is not found through PATH.
const isCanary = () =>
  Bun.spawnSync({ cmd: [bunExe(), "--revision"], env })
    .stdout.toString()
    .includes("-canary");
const uploadsReports = !isWindows && !isDebug && !isASAN && !isHardened && (isMacOS || isCanary());

describe.concurrent.skipIf(!uploadsReports)("the crash handler", () => {
  const asksNobody = { BUN_CRASH_REPORT_URL: undefined, BUN_ENABLE_CRASH_REPORTING: undefined };

  // The program that uploads holds the pipe for errors too, so the pipe ends when that program has ended. `ran` is
  // what it wrote to that pipe: it would be missing if the crash handler ever closed the pipe first.
  const outcome = (stderr: string, calls: string) => ({
    crashed: stderr.includes("bun.report"),
    ran: stderr.includes("uploader ran"),
    upload: existsSync(calls) ? readFileSync(calls, "utf8") : "",
  });
  const uploaded = { crashed: true, ran: true, upload: expect.stringContaining("bun.report") };
  const nothing = { crashed: true, ran: false, upload: "" };

  async function crashOf(command: string[], bunfig?: string) {
    using dir = project(bunfig);
    const [bin, calls] = ["bin", "calls"].map(name => join(String(dir), name));
    chmodSync(join(bin, "curl"), 0o755);
    const vars = { ...asksNobody, PATH: bin, CALLS: calls };
    return outcome((await run(String(dir), withoutCoreDump([bunExe(), ...command]), vars)).stderr, calls);
  }

  const commands: [name: string, command: string[]][] = [
    ["bun <file>", ["crash.js"]],
    ["bun test", ["test", "crash.test.js"]],
    ["bun build", ["build", "crash-build.js"]],
  ];
  test.each(commands)("uploads a report for %s when nothing turns that off", async (_, command) => {
    expect(await crashOf(command)).toEqual(uploaded);
  });
  test.each(commands)("uploads nothing for %s with `telemetry = false`", async (_, command) => {
    expect(await crashOf(command, "telemetry = false\n")).toEqual(nothing);
  });

  // A package manager command runs no JavaScript in its own process. Here it waits for a script of the package, and a
  // signal ends it.
  async function crashOfInstall(bunfig?: string, globalBunfig = "") {
    using dir = tempDir("bunfig-telemetry-install", {
      "package.json": JSON.stringify({
        name: "bunfig-telemetry",
        scripts: { postinstall: `${JSON.stringify(bunExe())} waits.js` },
      }),
      // The file appears with the number in it.
      "waits.js": `const { writeFileSync, renameSync } = require("fs");\nwriteFileSync("waiting.tmp", String(process.pid));\nrenameSync("waiting.tmp", "waiting");\nsetInterval(() => {}, 1 << 30);\n`,
      "bin/curl": files["bin/curl"],
      "config/.bunfig.toml": globalBunfig,
      ...(bunfig === undefined ? {} : { "bunfig.toml": bunfig }),
    });
    const [bin, calls, waiting] = ["bin", "calls", "waiting"].map(name => join(String(dir), name));
    chmodSync(join(bin, "curl"), 0o755);
    await using proc = Bun.spawn({
      cmd: withoutCoreDump([bunExe(), "install"]),
      env: {
        ...env,
        ...asksNobody,
        PATH: bin + ":" + process.env.PATH,
        CALLS: calls,
        XDG_CONFIG_HOME: join(String(dir), "config"),
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    for (const deadline = Date.now() + 30_000; !existsSync(waiting) && Date.now() < deadline;) await Bun.sleep(5);
    const script = Number(readFileSync(waiting, "utf8"));
    // Zero and what is below it name more than one process.
    expect(script).toBeGreaterThan(0);
    proc.kill("SIGSEGV");
    await proc.exited;
    // Linux ends the script with the command that started it. Elsewhere the script is still there, with the pipe.
    try {
      process.kill(script, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    return outcome(await stderr, calls);
  }

  test("uploads a report for bun install when nothing turns that off", async () => {
    expect(await crashOfInstall()).toEqual(uploaded);
  });

  test("uploads nothing for bun install with `telemetry = false`", async () => {
    expect(await crashOfInstall("telemetry = false\n")).toEqual(nothing);
  });

  test("uploads nothing for bun install with `telemetry = false` in the global file and `true` in the project", async () => {
    expect(await crashOfInstall("telemetry = true\n", "telemetry = false\n")).toEqual(nothing);
  });
});
