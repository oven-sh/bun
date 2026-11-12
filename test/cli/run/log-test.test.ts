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

describe.concurrent("bunfig.toml logLevel", () => {
  async function run(cmd: string[], files: Record<string, string>, env: Record<string, string> = {}) {
    using dir = tempDir("bunfig-log-level", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: { ...bunEnv, HOME: String(dir), XDG_CONFIG_HOME: undefined, BUN_CONFIG_VERBOSE_FETCH: undefined, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // `fetch()` prints its headers for BUN_CONFIG_VERBOSE_FETCH or its `verbose` option, and not for a log level.
  describe("the headers of a fetch()", () => {
    const debug = `logLevel = "debug"\n`;
    const serve = `using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });\n`;
    const fetchOnce = (options = "") =>
      serve + `const response = await fetch(server.url, { headers: { "x-probe": "1" }${options} });\n`;
    const script = (options = "") => fetchOnce(options) + `console.log(await response.text());\n`;
    const printed = (stderr: string) => ({
      headers: stderr.split("\n").filter(line => line.endsWith("x-probe: 1")).length,
      curl: stderr.split("\n").filter(line => line.includes("curl ") && line.includes(`-H "x-probe: 1"`)).length,
    });

    test.each([
      [{}, { headers: 0, curl: 0 }],
      [{ BUN_CONFIG_VERBOSE_FETCH: "true" }, { headers: 1, curl: 0 }],
      [{ BUN_CONFIG_VERBOSE_FETCH: "curl" }, { headers: 1, curl: 1 }],
    ] as const)("bun ./m.js, logLevel debug, env %j", async (env, expected) => {
      const { stdout, stderr, exitCode } = await run(["./m.js"], { "bunfig.toml": debug, "m.js": script() }, env);
      expect({ stdout, ...printed(stderr), exitCode }).toEqual({ stdout: "ok\n", ...expected, exitCode: 0 });
    });

    test("bun ./m.js, logLevel debug, fetch(url, { verbose: true })", async () => {
      const files = { "bunfig.toml": debug, "m.js": script(", verbose: true") };
      const { stdout, stderr, exitCode } = await run(["./m.js"], files);
      expect({ stdout, ...printed(stderr), exitCode }).toEqual({ stdout: "ok\n", headers: 1, curl: 0, exitCode: 0 });
    });

    test("bun test, logLevel debug", async () => {
      const body = fetchOnce() + `expect(await response.text()).toBe("ok");\n`;
      const files = {
        "bunfig.toml": debug,
        "m.test.js": `import { expect, test } from "bun:test";\ntest("fetch", async () => {\n${body}});\n`,
      };
      const { stderr, exitCode } = await run(["test", "./m.test.js"], files);
      expect({ ...printed(stderr), exitCode }).toEqual({ headers: 0, curl: 0, exitCode: 0 });
    });

    // `bun install` runs the scanner in a `bun -e` process. That process reads the bunfig.toml of the project.
    test.each([debug, `[install]\n` + debug])("the security scanner of bun install --silent, %j", async config => {
      const scan = fetchOnce() + `console.log("scanned", await response.text());\nreturn [];\n`;
      const files = {
        "bunfig.toml": config + `[install.security]\nscanner = "./scanner.ts"\n`,
        "scanner.ts": `export const scanner = {\n  version: "1",\n  async scan() {\n${scan}  },\n};\n`,
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      };
      const { stdout, stderr, exitCode } = await run(["install", "--silent"], files);
      expect({ stdout, ...printed(stderr), exitCode }).toEqual({
        stdout: "scanned ok\n",
        headers: 0,
        curl: 0,
        exitCode: 0,
      });
    });
  });
});
