import { spawnSync } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

it("should not log .env when quiet", async () => {
  using dir = tempDir("log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": `logLevel = "error"`,
    "index.ts": "export default console.log('Here');",
  });
  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
  });

  expect(stderr!.toString()).toBe("");
});

it("should log .env by default", async () => {
  using dir = tempDir("log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": ``,
    "index.ts": "export default console.log('Here');",
  });

  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
  });

  expect(stderr?.toString().includes(".env")).toBe(false);
});

// `bun <file>` loads bunfig.toml while it reads the command line. `bun run <file>` and the other ways to run code below
// load it after that.
describe.concurrent("bunfig.toml logLevel", () => {
  const levels = ["not set", "debug", "warn", "error"] as const;
  type Level = (typeof levels)[number];
  type Form = [name: string, cmd: string[], argv0?: string];
  const logLevel = (level: Level) => (level === "not set" ? "" : `logLevel = "${level}"\n`);
  const each = (forms: Form[]) => forms.flatMap(form => levels.map((level): [Level, Form] => [level, form]));
  const ran = `console.log("ran");\n`;
  const program = { "m.js": ran, "no-extension": ran };

  async function run(cmd: string[], files: Record<string, string>, env: Record<string, string> = {}, argv0?: string) {
    using dir = tempDir("bunfig-log-level", files);
    // Bun reads the user's own bunfig from one of these. None of them is the home of the user who runs the test.
    const home = { HOME: String(dir), USERPROFILE: String(dir), XDG_CONFIG_HOME: String(dir) };
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      argv0,
      env: { ...bunEnv, ...home, BUN_CONFIG_VERBOSE_FETCH: undefined, BUNFIG_LOG_LEVEL_UNSET: undefined, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const count = (stderr: string, prefix: string) => stderr.split("\n").filter(line => line.startsWith(prefix)).length;

  const early: Form = ["bun ./m.js", ["./m.js"]];
  const late: Form = ["bun run ./m.js", ["run", "./m.js"]];

  // `[macros]` takes package paths. For this key the bunfig loader adds one warning to the log of the command line.
  const badMacro = `[macros]\n"./not-a-package" = { "a" = "b" }\n`;
  // For a missing `extends` the resolver adds one debug message to the log that it writes to.
  const badTsconfig = `{ "extends": "./missing.json" }`;

  // A run prints this log after the entry point loads.
  describe("the warning and the debug message in the log", () => {
    const forms: Form[] = [
      early,
      late,
      ["bun ./no-extension", ["./no-extension"]],
      ["bun -e CODE arg", ["-e", ran, "arg"]],
      ["node ./m.js", ["./m.js"], "node"],
    ];

    for (const [level, [name, cmd, argv0]] of each(forms)) {
      test(`${name}, logLevel ${level}`, async () => {
        const files = { ...program, "bunfig.toml": logLevel(level) + badMacro, "tsconfig.json": badTsconfig };
        const { stdout, stderr, exitCode } = await run(cmd, files, {}, argv0);
        expect({ stdout, warn: count(stderr, "warn:"), debug: count(stderr, "debug:"), exitCode }).toEqual({
          stdout: "ran\n",
          warn: level === "error" ? 0 : 1,
          debug: level === "debug" ? 1 : 0,
          exitCode: 0,
        });
      });
    }

    // A load that fails ends `bun <file>`. `bun run <file>` reports it and then runs the file.
    for (const [[name, cmd], stdout, exitCode] of [
      [early, "", 1],
      [late, "ran\n", 0],
    ] as const) {
      test(`${name}, a file that sets a level and then fails to load sets no level`, async () => {
        const config = `logLevel = "error"\n` + badMacro + `[loader]\n".x" = "not-a-loader"\n`;
        const result = await run([...cmd], { ...program, "bunfig.toml": config });
        expect({
          stdout: result.stdout,
          warn: count(result.stderr, "warn:"),
          error: count(result.stderr, "error: Invalid loader"),
          exitCode: result.exitCode,
        }).toEqual({ stdout, warn: 1, error: 1, exitCode });
      });
    }
  });

  // At "debug" Bun prints how long it took to read each .env file. `bun repl` does not print the log above.
  describe("the line that names the .env file", () => {
    for (const [level, [name, cmd]] of each([early, late, ["bun repl -e", ["repl", "-e", ran]]])) {
      test(`${name}, logLevel ${level}`, async () => {
        const files = { ...program, "bunfig.toml": logLevel(level), ".env": "FOO=bar\n" };
        const { stdout, stderr, exitCode } = await run(cmd, files);
        expect({ stdout, namesEnvFile: stderr.includes(`] ".env"\n`), exitCode }).toEqual({
          stdout: "ran\n",
          namesEnvFile: level === "debug",
          exitCode: 0,
        });
      });
    }
  });

  describe("a log that is made after the load", () => {
    // `Bun.build()` makes its own log. The resolver adds its debug message for the tsconfig.json of the entry point to it.
    const build = {
      "m.js": `const { logs } = await Bun.build({ entrypoints: ["./sub/entry.js"], throw: false });\nconsole.log(JSON.stringify(logs.map(log => log.level)));\n`,
      "sub/entry.js": `export const a = 1;\n`,
      "sub/tsconfig.json": badTsconfig,
    };
    // The module has one warning (it assigns to a private method) and one error (it assigns to a constant).
    const failedImport = {
      "m.js": `await import("./bad.js");\n`,
      "bad.js": `class A {\n  #m() {}\n  f() {\n    this.#m = 1;\n  }\n}\nconst a = 1;\na = 2;\n`,
    };

    for (const [name, cmd] of [early, late]) {
      test.each([
        ["not set", "[]\n"],
        ["debug", `["debug"]\n`],
      ] as const)(`${name}, logLevel %s, the levels of Bun.build().logs`, async (level, levels) => {
        const { stdout, exitCode } = await run(cmd, { "bunfig.toml": logLevel(level), ...build });
        expect({ stdout, exitCode }).toEqual({ stdout: levels, exitCode: 0 });
      });

      test.each([
        ["not set", 1],
        ["error", 0],
      ] as const)(`${name}, logLevel %s, an import() that fails`, async (level, warn) => {
        const { stderr, exitCode } = await run(cmd, { "bunfig.toml": logLevel(level), ...failedImport });
        expect({ warn: count(stderr, "warn:"), error: count(stderr, "error:"), exitCode }).toEqual({
          warn,
          error: 1,
          exitCode: 1,
        });
      });
    }
  });

  // `fetch()` prints its headers for BUN_CONFIG_VERBOSE_FETCH or its `verbose` option, and not for a log level.
  describe("the headers of a fetch()", () => {
    // At "debug" Bun names each .env file that it reads. That line shows that the level reached the process.
    const debug = { "bunfig.toml": logLevel("debug"), ".env": "FOO=bar\n" };
    const serve = `using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });\n`;
    const fetchOnce = (options = "") =>
      serve + `const response = await fetch(server.url, { headers: { "x-probe": "1" }${options} });\n`;
    const script = (options = "") => fetchOnce(options) + `console.log(await response.text());\n`;
    const printed = (stderr: string) => ({
      namesEnvFile: stderr.includes(`] ".env"\n`),
      headers: stderr.split("\n").filter(line => line.endsWith("x-probe: 1")).length,
      curl: stderr.split("\n").filter(line => line.includes("curl ") && line.includes(`-H "x-probe: 1"`)).length,
    });

    for (const [name, cmd] of [early, late]) {
      test.each([
        [{}, { headers: 0, curl: 0 }],
        [{ BUN_CONFIG_VERBOSE_FETCH: "true" }, { headers: 1, curl: 0 }],
        [{ BUN_CONFIG_VERBOSE_FETCH: "curl" }, { headers: 1, curl: 1 }],
      ] as const)(`${name}, logLevel debug, env %j`, async (env, expected) => {
        const { stdout, stderr, exitCode } = await run(cmd, { ...debug, "m.js": script() }, env);
        expect({ stdout, ...printed(stderr), exitCode }).toEqual({
          stdout: "ok\n",
          namesEnvFile: true,
          ...expected,
          exitCode: 0,
        });
      });
    }

    test("bun ./m.js, logLevel debug, fetch(url, { verbose: true })", async () => {
      const { stdout, stderr, exitCode } = await run(["./m.js"], { ...debug, "m.js": script(", verbose: true") });
      expect({ stdout, ...printed(stderr), exitCode }).toEqual({
        stdout: "ok\n",
        namesEnvFile: true,
        headers: 1,
        curl: 0,
        exitCode: 0,
      });
    });

    test("bun test, logLevel debug", async () => {
      const body = fetchOnce() + `expect(await response.text()).toBe("ok");\n`;
      const files = {
        ...debug,
        "m.test.js": `import { expect, test } from "bun:test";\ntest("fetch", async () => {\n${body}});\n`,
      };
      const { stderr, exitCode } = await run(["test", "./m.test.js"], files);
      expect({ ...printed(stderr), exitCode }).toEqual({ namesEnvFile: true, headers: 0, curl: 0, exitCode: 0 });
    });

    // `bun install` runs the scanner in a `bun -e` process. That process reads the bunfig.toml of the project and no
    // .env file. It shows the level in the log of a `Bun.build()`: at "debug" the resolver adds a message about the
    // tsconfig.json to it.
    test.each([logLevel("debug"), `[install]\n` + logLevel("debug")])(
      "the security scanner of bun install --silent, %j",
      async config => {
        const scan =
          fetchOnce() +
          `const { logs } = await Bun.build({ entrypoints: ["./sub/entry.js"], throw: false });\n` +
          `console.log("scanned", await response.text(), JSON.stringify(logs.map(log => log.level)));\nreturn [];\n`;
        const files = {
          "bunfig.toml": config + `[install.security]\nscanner = "./scanner.ts"\n`,
          "scanner.ts": `export const scanner = {\n  version: "1",\n  async scan() {\n${scan}  },\n};\n`,
          "sub/entry.js": `export const a = 1;\n`,
          "sub/tsconfig.json": badTsconfig,
          "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
          "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        };
        const { stdout, stderr, exitCode } = await run(["install", "--silent"], files);
        expect({ stdout, headers: printed(stderr).headers, exitCode }).toEqual({
          stdout: `scanned ok ["debug"]\n`,
          headers: 0,
          exitCode: 0,
        });
      },
    );
  });

  // The type checker reads a repeated key of a package.json as TypeScript does: the last value counts.
  describe("the type checker", () => {
    const compilerOptions = {
      strict: true,
      noEmit: true,
      module: "esnext",
      moduleResolution: "bundler",
      lib: ["es5"],
      types: [],
    };
    const files = {
      "tsconfig.json": JSON.stringify({ compilerOptions }),
      "console.d.ts": `declare var console: { log(...args: unknown[]): void };\n`,
      "m.ts": `import { value } from "dep";\nconst n: number = value;\nconsole.log("ran", n);\n`,
      "node_modules/dep/package.json": `{ "name": "dep", "exports": { ".": { "types": "./string.d.ts", "types": "./number.d.ts", "default": "./index.js" } } }`,
      "node_modules/dep/string.d.ts": `export const value: string;\n`,
      "node_modules/dep/number.d.ts": `export const value: number;\n`,
      "node_modules/dep/index.js": `exports.value = 1;\n`,
    };
    const forms: Form[] = [
      ["bun --check ./m.ts", ["--check", "./m.ts"]],
      ["bun run --check ./m.ts", ["run", "--check", "./m.ts"]],
    ];

    for (const [name, cmd] of forms) {
      test.each(["not set", "error"] as const)(`${name}, logLevel %s`, async level => {
        const { stdout, exitCode } = await run(cmd, { "bunfig.toml": logLevel(level), ...files });
        expect({ stdout, exitCode }).toEqual({ stdout: "ran 1\n", exitCode: 0 });
      });
    }
  });

  // The package manager takes its level from --silent and --verbose.
  describe("bun install", () => {
    const install = (flags: string[], config: string) =>
      run(["install", ...flags], { "bunfig.toml": config, "package.json": `{ "name": "a" }` });

    test.each([`logLevel = "error"\n`, `[install]\nlogLevel = "error"\n`])("does not take %j", async config => {
      const { stderr, exitCode } = await install([], config + badMacro);
      expect({ warn: count(stderr, "warn:"), exitCode }).toEqual({ warn: 1, exitCode: 0 });
    });

    // Bun warns about the unset variable before it applies --silent to the log of the command line.
    const unsetToken = `logLevel = "debug"\n[install]\nregistry = { url = "http://localhost/", token = "$BUNFIG_LOG_LEVEL_UNSET" }\n`;

    test("warns about an unset variable in the registry token", async () => {
      const { stderr, exitCode } = await install([], unsetToken);
      expect({ warn: count(stderr, "warn:"), exitCode }).toEqual({ warn: 1, exitCode: 0 });
      expect(stderr).toContain("references unset variable");
    });

    test(`--silent prints nothing with logLevel = "debug"`, async () => {
      expect(await install(["--silent"], unsetToken)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });
  });

  // Both count the warning for a repeated JSON key to decide how to read a config file, so they need to keep it.
  describe.each(["", `logLevel = "error"\n`])("bunfig.toml %j", config => {
    test("bun lint gives a rule the last value of a repeated key", async () => {
      const { stdout, exitCode } = await run(["lint", "-f", "json", "a.test.js"], {
        "bunfig.toml": config,
        ".oxlintrc.json": `{ "plugins": ["jest"], "categories": { "correctness": "off" }, "rules": { "jest/no-restricted-matchers": ["error", { "toBe": "first", "toBe": "last" }] } }`,
        "a.test.js": `test("t", () => {\n  expect(a).toBe(1);\n});\n`,
      });
      expect({ help: JSON.parse(stdout).diagnostics.map((it: { help: string }) => it.help), exitCode }).toEqual({
        help: ["last"],
        exitCode: 1,
      });
    });

    test("bun fmt warns once about a repeated unknown option", async () => {
      const { stderr, exitCode } = await run(["fmt", "--check", "a.js"], {
        "bunfig.toml": config,
        ".prettierrc.json": `{ "foo": 1, "foo": 2 }`,
        "a.js": `export const a = 1;\n`,
      });
      expect({ warnings: stderr.split("\n").filter(line => line.startsWith("warn:")), exitCode }).toEqual({
        warnings: ["warn: Ignored unknown option { foo: 2 }."],
        exitCode: 0,
      });
    });
  });
});
