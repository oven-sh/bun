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

// Not concurrent: every case spawns a bun subprocess, and ten ASAN subprocesses
// at once push individual cases past the per-test timeout on CI-sized machines.
describe("extensionless import with case-differing sibling (#22686)", () => {
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
      // Both modules were resolved and inlined into the bundle.
      expect(bundled).toContain("lower-ts");
      expect(bundled).toContain("upper-tsx");
      expect(buildExit).toBe(0);
    });
  });

  // One row per extension-probe site. In every row the higher-priority
  // extension exists only under a different case, so the two files coexist on
  // any filesystem. A case-insensitive filesystem opens the probed spelling and
  // keeps extension priority (the "upper" file); a case-sensitive one rejects
  // it and falls through to the exact-case "lower" file. Both branches also
  // assert the resolved path is the on-disk spelling.
  const rows: [
    site: string,
    files: Record<string, string>,
    specifier: string,
    insensitive: string,
    sensitive: string,
  ][] = [
    [
      "load_extension",
      { "Config.ts": `export const which = "upper";`, "config.json": `{ "which": "lower" }` },
      "./config",
      "Config.ts",
      "config.json",
    ],
    [
      "load_index_with_extension",
      { "lib/Index.tsx": `export const which = "upper";`, "lib/index.ts": `export const which = "lower";` },
      "./lib",
      "lib/Index.tsx",
      "lib/index.ts",
    ],
    [
      "js->ts rewrite",
      { "Mod.ts": `export const which = "upper";`, "mod.tsx": `export const which = "lower";` },
      "./mod.js",
      "Mod.ts",
      "mod.tsx",
    ],
    [
      "exports wildcard",
      {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: { "./*": "./dist/*" } }),
        "node_modules/pkg/dist/Foo.tsx": `export const which = "upper";`,
        "node_modules/pkg/dist/foo.ts": `export const which = "lower";`,
      },
      "pkg/foo",
      "node_modules/pkg/dist/Foo.tsx",
      "node_modules/pkg/dist/foo.ts",
    ],
    [
      "exports wildcard js->ts rewrite",
      {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: { "./*": "./dist/*.js" } }),
        "node_modules/pkg/dist/Mod.ts": `export const which = "upper";`,
        "node_modules/pkg/dist/mod.tsx": `export const which = "lower";`,
      },
      "pkg/mod",
      "node_modules/pkg/dist/Mod.ts",
      "node_modules/pkg/dist/mod.tsx",
    ],
  ];

  test.each(rows)(
    "%s: case-mismatched probe is kept only if it opens",
    async (_site, files, specifier, insensitive, sensitive) => {
      using dir = tempDir("22686-matrix", {
        ...files,
        "entry.ts": `
        import { which } from ${JSON.stringify(specifier)};
        console.log(which);
        console.log(Bun.resolveSync(${JSON.stringify(specifier)}, import.meta.dir));
      `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.ts");
      expect(stderr).toBe("");
      const expected = isCaseSensitiveFS
        ? ["lower", join(String(dir), sensitive)]
        : ["upper", join(String(dir), insensitive)];
      expect(stdout.trim().split("\n")).toEqual(expected);
      expect(exitCode).toBe(0);
    },
  );

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

  // handle_esm_resolution has no extension loop, so a case-mismatched exports target is accepted like
  // the bare-path probe accepts one; what changed is that the cached path is the on-disk spelling.
  // Before, the queried spelling was cached: ENOENT on a case-sensitive filesystem, and the wrong
  // path reported on a case-insensitive one.
  test("exports target spelled in a different case than the file resolves to the on-disk path", async () => {
    using dir = tempDir("22686-exports-target", {
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: { ".": "./dist/foo.js" } }),
      "node_modules/pkg/dist/Foo.js": `export const which = "on-disk";`,
      "entry.ts": `
        import { which } from "pkg";
        console.log(which);
        console.log(Bun.resolveSync("pkg", import.meta.dir));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.ts");
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n")).toEqual(["on-disk", join(String(dir), "node_modules", "pkg", "dist", "Foo.js")]);
    expect(exitCode).toBe(0);
  });

  // A specifier ending in a separator still goes through the js -> ts rewrite. Deriving the cached
  // path from the probed spelling gave "<dir>/ffoo.ts" there (basename offset off by one) and, as
  // the entry is shared, broke every later import of foo.ts in the process too.
  test("js->ts rewrite of a specifier with a trailing slash caches the entry's real path", async () => {
    using dir = tempDir("22686-trailing-slash", {
      "foo.ts": `export const which = "foo-ts";`,
      "entry.ts": `
        const dir = import.meta.dir;
        console.log(Bun.resolveSync("./foo.js/", dir));
        console.log(Bun.resolveSync("./foo.js", dir));
        console.log(Bun.resolveSync("./foo.ts", dir));
        const { which } = await import("./foo.ts");
        console.log(which);
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.ts");
    expect(stderr).toBe("");
    const fooTs = join(String(dir), "foo.ts");
    expect(stdout.trim().split("\n")).toEqual([fooTs, fooTs, fooTs, "foo-ts"]);
    expect(exitCode).toBe(0);
  });
});
