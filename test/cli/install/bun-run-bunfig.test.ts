import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, toTOMLString } from "harness";
import { join as pathJoin } from "node:path";

describe.each(["bun run", "bun"])(`%s`, cmd => {
  const runCmd = cmd === "bun" ? ["-c=bunfig.toml", "run"] : ["-c=bunfig.toml"];
  const node = Bun.which("node")!;
  const execPath = process.execPath;

  describe.each(["--bun", "without --bun"])("%s", cmd2 => {
    test("which node", async () => {
      const bun = cmd2 === "--bun";
      const bunFlag = bun ? ["--bun"] : [];
      const bunfig = toTOMLString({
        run: {
          bun,
        },
      });

      await using cwd = tempDir("run.where.node", {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              "where-node": `which node`,
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), "--silent", ...bunFlag, ...runCmd, "where-node"],
        env: bunEnv,
        stderr: "inherit",
        stdout: "pipe",
        stdin: "ignore",
        cwd,
      });
      const nodeBin = result.stdout.toString().trim();

      if (bun) {
        if (isWindows) {
          expect(realpathSync(nodeBin)).toContain("\\bun-node-");
        } else {
          expect(realpathSync(nodeBin)).toBe(realpathSync(execPath));
        }
      } else {
        expect(realpathSync(nodeBin)).toBe(realpathSync(node));
      }
      expect(result.success).toBeTrue();
    });
  });

  describe.each(["bun", "system", "default"])(`run.shell = "%s"`, shellStr => {
    if (isWindows && shellStr === "system") return; // windows always uses the bun shell now
    const shell = shellStr === "default" ? (isWindows ? "bun" : "system") : shellStr;
    const command_not_found =
      isWindows && shell === "system" ? "is not recognized as an internal or external command" : "command not found";
    test.each(["true", "false"])('run.silent = "%s"', silentStr => {
      const silent = silentStr === "true";
      const bunfig = toTOMLString({
        run: {
          shell: shellStr === "default" ? undefined : shell,
          silent,
        },
      });

      using cwd = tempDir(Bun.hash(bunfig).toString(36), {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              startScript: "echo 1",
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), ...runCmd, "startScript"],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
        stdin: "ignore",
        cwd,
      });

      if (silent) {
        expect(result.stderr.toString().trim()).toBe("");
      } else {
        expect(result.stderr.toString().trim()).toContain("$ echo 1");
      }
      expect(result.success).toBeTrue();
    });
    test("command not found", async () => {
      const bunfig = toTOMLString({
        run: {
          shell,
        },
      });

      await using cwd = tempDir("run.shell.system-" + Bun.hash(bunfig).toString(32), {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              start: "this-should-start-with-bun-in-the-error-message",
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), "--silent", ...runCmd, "start"],
        env: bunEnv,
        stderr: "pipe",
        stdout: "inherit",
        stdin: "ignore",
        cwd,
      });

      const err = result.stderr.toString().trim();
      expect(err).toContain(command_not_found);
      expect(err).toContain("this-should-start-with-bun-in-the-error-message");
      expect(result.success).toBeFalse();
    });
  });

  test("autoload local bunfig.toml (same cwd)", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    await using cwd = tempDir("run.where.node", {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd,
    });
    const nodeBin = result.stdout.toString().trim();

    if (isWindows) {
      expect(realpathSync(nodeBin)).toContain("\\bun-node-");
    } else {
      expect(realpathSync(nodeBin)).toBe(realpathSync(execPath));
    }
  });

  test("autoload the project's bunfig.toml (sub cwd)", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    await using cwd = tempDir("run.where.node", {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
      "subdir/a.txt": "a",
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd: pathJoin(cwd, "./subdir"),
    });
    const nodeBin = result.stdout.toString().trim();

    if (isWindows) {
      expect(realpathSync(nodeBin)).toContain("\\bun-node-");
    } else {
      expect(realpathSync(nodeBin)).toBe(realpathSync(execPath));
    }
    expect(result.success).toBeTrue();
  });

  test("NOT autoload home bunfig.toml", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    await using cwd = tempDir("run.where.node", {
      "my-home/.bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: {
        ...bunEnv,
        HOME: pathJoin(cwd, "./my-home"),
      },
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd,
    });
    const nodeBin = result.stdout.toString().trim();

    expect(realpathSync(nodeBin)).toBe(realpathSync(node));
    expect(result.success).toBeTrue();
  });
});

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("a flag of `bun run <file>` wins over its key in bunfig.toml", () => {
  test.each([
    {
      name: "--define replaces the same key of [define] and keeps the others",
      files: {
        "bunfig.toml": `[define]\nA = "1"\nB = "2"\n`,
        "index.js": `console.log(A, B, typeof C);`,
      },
      entry: "index.js",
      flags: ["--define", "B=20", "--define", "C=3"],
      withFlags: "1 20 number\n",
      withoutFlags: "1 2 undefined\n",
    },
    {
      name: "--loader replaces the same extension of [loader] and keeps the others",
      files: {
        "bunfig.toml": `[loader]\n".foo" = "json"\n".bar" = "json"\n`,
        "a.foo": `{}`,
        "a.bar": `{}`,
        "index.js": `import foo from "./a.foo";\nimport bar from "./a.bar";\nconsole.log(typeof foo, typeof bar);`,
      },
      entry: "index.js",
      flags: ["--loader", ".bar:text"],
      withFlags: "object string\n",
      withoutFlags: "object object\n",
    },
    {
      name: "--console-depth",
      files: {
        "bunfig.toml": `[console]\ndepth = 1\n`,
        "index.js": `console.log({ a: { b: { c: 1 } } });`,
      },
      entry: "index.js",
      flags: ["--console-depth", "3"],
      withFlags: "{\n  a: {\n    b: {\n      c: 1,\n    },\n  },\n}\n",
      withoutFlags: "{\n  a: {\n    b: [Object ...],\n  },\n}\n",
    },
    {
      name: "--jsx-factory",
      files: {
        "bunfig.toml": `jsx = "react"\njsxFactory = "fromFile"\n`,
        "index.jsx": `const fromFile = () => "file", fromFlag = () => "flag";\nconsole.log(<div />);`,
      },
      entry: "index.jsx",
      flags: ["--jsx-factory", "fromFlag"],
      withFlags: "flag\n",
      withoutFlags: "file\n",
    },
  ])("$name", async ({ files, entry, flags, withFlags, withoutFlags }) => {
    using dir = tempDir("run-flag-wins", files);
    expect(await bun(String(dir), "run", ...flags, entry)).toEqual({ stdout: withFlags, stderr: "", exitCode: 0 });
    expect(await bun(String(dir), "run", entry)).toEqual({ stdout: withoutFlags, stderr: "", exitCode: 0 });
  });

  test("--jsx-runtime classic, next to a bunfig.toml without a jsx key", async () => {
    using dir = tempDir("run-flag-wins", {
      "bunfig.toml": `logLevel = "warn"\n`,
      "index.jsx": `const React = { createElement: tag => "classic " + tag };\nconsole.log(<div />);`,
    });
    expect(await bun(String(dir), "run", "--jsx-runtime", "classic", "index.jsx")).toEqual({
      stdout: "classic div\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("--no-macros, next to a [macros] table", async () => {
    using dir = tempDir("run-flag-wins", {
      "bunfig.toml": `[macros]\npkg = { value = "./macro.ts" }\n`,
      "macro.ts": `export const value = () => 42;`,
      "index.ts": `import { value } from "./macro.ts" with { type: "macro" };\nconsole.log(value());`,
    });
    const { stderr, exitCode } = await bun(String(dir), "run", "--no-macros", "index.ts");
    expect(stderr).toContain("Macros are disabled");
    expect(exitCode).toBe(1);
  });

  test('--no-install, next to [install] auto = "fallback"', async () => {
    const requests: string[] = [];
    using registry = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response("not found", { status: 404 });
      },
    });
    using dir = tempDir("run-flag-wins", {
      "bunfig.toml": `[install]\nauto = "fallback"\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
      "index.js": `import "not-installed";`,
    });
    expect((await bun(String(dir), "run", "--no-install", "index.js")).exitCode).toBe(1);
    expect(requests).toEqual([]);
    expect((await bun(String(dir), "run", "index.js")).exitCode).toBe(1);
    expect(requests).toEqual(["/not-installed"]);
  });

  // On Windows package.json scripts always run in Bun's shell.
  test.skipIf(isWindows).each([
    { key: "bun", flag: "system", expected: expect.not.stringContaining("bun: command not found") },
    { key: "system", flag: "bun", expected: expect.stringContaining("bun: command not found") },
  ])('--shell=$flag, next to [run] shell = "$key"', async ({ key, flag, expected }) => {
    using dir = tempDir("run-flag-wins", {
      "bunfig.toml": `[run]\nshell = "${key}"\n`,
      "package.json": JSON.stringify({ scripts: { start: "not-a-command" } }),
    });
    const { stderr, exitCode } = await bun(String(dir), "run", "--silent", `--shell=${flag}`, "start");
    expect(stderr).toEqual(expected);
    expect(exitCode).not.toBe(0);
  });

  test("--bun, next to [run] bun = false", async () => {
    using dir = tempDir("run-flag-wins", {
      "bunfig.toml": `[run]\nbun = false\n`,
      "package.json": JSON.stringify({ scripts: { start: `node -e "console.log(typeof Bun)"` } }),
    });
    expect(await bun(String(dir), "run", "--silent", "--bun", "start")).toEqual({
      stdout: "object\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// In smol mode a Blob is kept in a memfd from 1 MiB on, otherwise from 8 MiB on.
describe.skipIf(!isLinux).concurrent("smol in bunfig.toml", () => {
  const isSmol = `
    const { readdirSync, readlinkSync } = require("node:fs");
    const blob = new Blob([new Uint8Array(2 * 1024 * 1024)]);
    const links = readdirSync("/proc/self/fd").map(fd => {
      try {
        return readlinkSync("/proc/self/fd/" + fd);
      } catch {
        return "";
      }
    });
    console.log(links.some(link => link.startsWith("/memfd:memfd-num-")) ? "smol" : "normal", blob.size);
  `;

  test.each([
    { name: "bun index.js without the key is not smol", bunfig: "", args: ["index.js"], expected: "normal" },
    { name: "smol = true applies to bun index.js", bunfig: "smol = true", args: ["index.js"], expected: "smol" },
    {
      name: "smol = true applies to bun run index.js",
      bunfig: "smol = true",
      args: ["run", "index.js"],
      expected: "smol",
    },
    {
      name: "bun run --smol wins over smol = false",
      bunfig: "smol = false",
      args: ["run", "--smol", "index.js"],
      expected: "smol",
    },
  ])("$name", async ({ bunfig, args, expected }) => {
    using dir = tempDir("bunfig-smol", { "bunfig.toml": bunfig, "index.js": isSmol });
    expect(await bun(String(dir), ...args)).toEqual({ stdout: `${expected} 2097152\n`, stderr: "", exitCode: 0 });
  });
});
