import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Detect filesystem case-sensitivity at runtime rather than hard-coding the
// platform: on a case-insensitive filesystem the second write below overwrites
// the first, so reading the lowercase name returns "b".
using probeDir = tempDir("case-probe-22686", {
  "probe.txt": "a",
  "Probe.txt": "b",
});
const isCaseSensitiveFS = readFileSync(join(String(probeDir), "probe.txt"), "utf8") === "a";

async function run(dir: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("extensionless import with case-differing sibling (#22686)", () => {
  describe.skipIf(!isCaseSensitiveFS)("case-sensitive filesystem", () => {
    test("todos.ts + Todos.tsx: import './todos' resolves to todos.ts", async () => {
      using dir = tempDir("22686-a", {
        "todos.ts": `export const todos = ["lower-ts"];`,
        "Todos.tsx": `export function Todos() { return "upper-tsx"; }`,
        "entry.tsx": `
          import { todos } from "./todos";
          import { Todos } from "./Todos";
          console.log(JSON.stringify({ todos, Todos: Todos() }));
          console.log(Bun.resolveSync("./todos", import.meta.dir));
          console.log(Bun.resolveSync("./Todos", import.meta.dir));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.tsx");
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(JSON.parse(lines[0])).toEqual({ todos: ["lower-ts"], Todos: "upper-tsx" });
      expect(lines[1]).toBe(join(String(dir), "todos.ts"));
      expect(lines[2]).toBe(join(String(dir), "Todos.tsx"));
      expect(exitCode).toBe(0);
    });

    test("Todos.ts + todos.tsx: import './Todos' resolves to Todos.ts", async () => {
      using dir = tempDir("22686-b", {
        "Todos.ts": `export const Todos = "upper-ts";`,
        "todos.tsx": `export const todos = "lower-tsx";`,
        "entry.tsx": `
          import { Todos } from "./Todos";
          import { todos } from "./todos";
          console.log(JSON.stringify({ Todos, todos }));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.tsx");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({ Todos: "upper-ts", todos: "lower-tsx" });
      expect(exitCode).toBe(0);
    });

    test("require('./todos') with todos.ts + Todos.tsx", async () => {
      using dir = tempDir("22686-c", {
        "todos.ts": `module.exports = "lower-ts";`,
        "Todos.tsx": `module.exports = "upper-tsx";`,
        "entry.ts": `
          console.log(JSON.stringify({
            lower: require("./todos"),
            upper: require("./Todos"),
            lowerPath: require.resolve("./todos"),
            upperPath: require.resolve("./Todos"),
          }));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.ts");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        lower: "lower-ts",
        upper: "upper-tsx",
        lowerPath: join(String(dir), "todos.ts"),
        upperPath: join(String(dir), "Todos.tsx"),
      });
      expect(exitCode).toBe(0);
    });

    test("only Todos.tsx: import './todos' is not found", async () => {
      // Before the fix this matched the entry and cached the queried spelling,
      // failing with `ENOENT reading ".../todos.tsx"`. Now the probe is
      // rejected (the queried spelling does not exist) and resolution fails
      // cleanly, matching Node's stat-based probe.
      using dir = tempDir("22686-d", {
        "Todos.tsx": `export const value = "only-upper";`,
        "entry.tsx": `console.log(Bun.resolveSync("./todos", import.meta.dir));`,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.tsx");
      expect(stderr).not.toContain("ENOENT");
      expect(stderr).toContain("./todos");
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });

    test("index: lib/index.ts + lib/Index.tsx: import './lib' resolves to index.ts", async () => {
      using dir = tempDir("22686-e", {
        "lib/index.ts": `export const which = "lower-ts";`,
        "lib/Index.tsx": `export const which = "upper-tsx";`,
        "entry.ts": `
          import { which } from "./lib";
          console.log(which);
          console.log(Bun.resolveSync("./lib", import.meta.dir));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.ts");
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe("lower-ts");
      expect(lines[1]).toBe(join(String(dir), "lib", "index.ts"));
      expect(exitCode).toBe(0);
    });

    test("js->ts rewrite: import './mod.js' with Mod.ts + mod.tsx resolves to mod.tsx", async () => {
      using dir = tempDir("22686-f", {
        "Mod.ts": `export const which = "upper-ts";`,
        "mod.tsx": `export const which = "lower-tsx";`,
        "entry.ts": `
          import { which } from "./mod.js";
          console.log(which);
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.ts");
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("lower-tsx");
      expect(exitCode).toBe(0);
    });

    test("bun build: todos.ts + Todos.tsx bundle correctly", async () => {
      using dir = tempDir("22686-g", {
        "todos.ts": `export const todos = ["lower-ts"];`,
        "Todos.tsx": `export function Todos() { return "upper-tsx"; }`,
        "entry.tsx": `
          import { todos } from "./todos";
          import { Todos } from "./Todos";
          console.log(JSON.stringify({ todos, Todos: Todos() }));
        `,
      });
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "entry.tsx", "--target=bun"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [bundled, buildErr, buildExit] = await Promise.all([
        build.stdout.text(),
        build.stderr.text(),
        build.exited,
      ]);
      expect(buildErr).not.toContain("error:");
      expect(buildExit).toBe(0);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", bundled],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({ todos: ["lower-ts"], Todos: "upper-tsx" });
      expect(exitCode).toBe(0);
    });
  });

  // This test runs on all filesystems. The extensions differ so the two files
  // coexist regardless of case-sensitivity; the resolved target depends on
  // whether `config.ts` opens `Config.ts`.
  test("Config.ts + config.json: import './config' respects extension priority", async () => {
    using dir = tempDir("22686-h", {
      "Config.ts": `export default "upper-ts";`,
      "config.json": `{ "which": "lower-json" }`,
      "entry.ts": `
        import v from "./config";
        console.log(JSON.stringify(v));
        console.log(Bun.resolveSync("./config", import.meta.dir));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.ts");
    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    if (isCaseSensitiveFS) {
      // `config.ts` does not exist; `.json` is the first extension that hits.
      expect(JSON.parse(lines[0])).toEqual({ which: "lower-json" });
      expect(lines[1]).toBe(join(String(dir), "config.json"));
    } else {
      // `config.ts` opens `Config.ts`; `.ts` comes before `.json` in the
      // extension order, so `Config.ts` wins.
      expect(JSON.parse(lines[0])).toBe("upper-ts");
      expect(lines[1]).toBe(join(String(dir), "Config.ts"));
    }
    expect(exitCode).toBe(0);
  });

  test.skipIf(isCaseSensitiveFS)("only Todos.tsx on case-insensitive FS: import './todos' resolves", async () => {
    using dir = tempDir("22686-i", {
      "Todos.tsx": `export const value = "only-upper";`,
      "entry.tsx": `
        import { value } from "./todos";
        console.log(value);
        console.log(Bun.resolveSync("./todos", import.meta.dir));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.tsx");
    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("only-upper");
    expect(lines[1]).toBe(join(String(dir), "Todos.tsx"));
    expect(exitCode).toBe(0);
  });
});
