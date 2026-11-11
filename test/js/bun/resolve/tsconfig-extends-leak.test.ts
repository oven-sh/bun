// Resolving a directory whose tsconfig.json uses "extends" used to leak every
// intermediate TSConfigJSON struct (and its PathsMap) in the chain. The merge
// loop in dirInfoUncached() popped each parent config, copied its fields into
// the base, and dropped the pointer on the floor — the code literally had a
// `// todo deinit these parent configs somehow?` comment. Combined with
// bustDirCache (which re-runs dirInfoUncached on every HMR / router reload),
// this re-leaked the whole chain on every cycle.
//
// The tsconfig re-parse path has several other ambient allocations into
// bun.default_allocator (file contents, JSON property arrays) that dwarf the
// TSConfigJSON struct itself, so RSS can't isolate this leak. Instead we use
// the debug-build `BUN_DEBUG_alloc=1` instrumentation which logs every
// bun.new()/bun.destroy() call, and count TSConfigJSON lifetimes directly.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import path from "path";
import { unsupported as aotUnsupported } from "../../../aot/harness/compiler";

// The allocation log is only emitted in builds with Environment.allow_assert
// (debug/ReleaseSafe). Release CI lanes skip this; the gate runs under bun bd
// which is debug+ASAN, so it's covered.
test.skipIf(!isDebug)("tsconfig 'extends' chain frees every intermediate TSConfigJSON", async () => {
  // leaf -> tsconfig.1 -> tsconfig.2 -> ... -> tsconfig.N
  // Each hop defines paths so both leak sites are exercised: the overwritten
  // merged_config.paths and the dropped *TSConfigJSON struct.
  const chainDepth = 10;
  const files: Record<string, string> = {
    "d/index.ts": "export default 1;\n",
    "d/tsconfig.json": JSON.stringify({
      extends: "../base/tsconfig.1.json",
      compilerOptions: { paths: { "@leaf/*": ["./src/*"] } },
    }),
  };
  for (let i = 1; i <= chainDepth; i++) {
    files[`base/tsconfig.${i}.json`] = JSON.stringify({
      ...(i < chainDepth ? { extends: `./tsconfig.${i + 1}.json` } : {}),
      compilerOptions: { paths: { [`@base${i}/*`]: ["./src/*"] } },
    });
  }

  using dir = tempDir("tsconfig-extends-leak", files);
  const resolveFrom = path.join(String(dir), "d") + path.sep;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Bun.resolveSync("./index.ts", ${JSON.stringify(resolveFrom)});`],
    env: {
      ...bunEnv,
      // Enable the `.alloc` scoped logger (emits "[alloc] new(T) = ..." /
      // "[alloc] destroy(T) = ..." for every bun.new/bun.destroy). This
      // overrides BUN_DEBUG_QUIET_LOGS for the `.alloc` scope specifically.
      BUN_DEBUG_alloc: "1",
    },
    // Run from the temp dir so the resolver doesn't pick up any stray
    // tsconfig.json from the repo root as an extra allocation.
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Output.scoped writes to whichever stream it chose at init; scan both.
  const output = stdout + stderr;
  const created = [...output.matchAll(/new\(TSConfigJSON\)/g)].length;
  const destroyed = [...output.matchAll(/destroy\(TSConfigJSON\)/g)].length;

  // The whole chain (leaf + chainDepth bases) must be parsed. dirInfoUncached
  // also walks every ancestor of the temp dir up to the filesystem root, so a
  // stray tsconfig.json/jsconfig.json in e.g. the developer's home directory
  // on Windows would add to `created` (and stay live in dir_cache) — don't
  // assert exact equality. The property the fix guarantees is that every
  // intermediate in the extends chain is destroyed; before the fix,
  // `destroyed` was 0 regardless of chain depth.
  expect(created).toBeGreaterThanOrEqual(chainDepth + 1);
  expect(destroyed).toBeGreaterThanOrEqual(chainDepth);
  // Only the merged config for d/ plus any ancestor configs outside the
  // fixture may remain live. On a clean CI runner this is exactly 1.
  expect(created - destroyed).toBeLessThan(chainDepth);
  expect(exitCode).toBe(0);
});

// Correctness: after freeing the intermediate structs, the merged config must
// still resolve paths defined in the leaf and keep the merge semantics intact.
// Guards against accidentally freeing data the merged config still references
// (the merged struct borrows string slices from the intermediates' source
// buffers, which outlive the struct).
test("tsconfig 'extends' merge still works after freeing intermediates", async () => {
  using dir = tempDir("tsconfig-extends-merge", {
    "tsconfig.base2.json": JSON.stringify({
      compilerOptions: {
        paths: { "@base/*": ["./lib/base/*"] },
      },
    }),
    "tsconfig.base1.json": JSON.stringify({
      extends: "./tsconfig.base2.json",
      compilerOptions: { jsx: "react-jsx" },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./tsconfig.base1.json",
      compilerOptions: {
        paths: { "@leaf/*": ["./lib/leaf/*"] },
      },
    }),
    "lib/leaf/thing.ts": `export const who = "leaf";`,
    "index.ts": `
      import { who } from "@leaf/thing";
      console.log(who);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("leaf");
  expect(exitCode).toBe(0);
});

// A decorator option the extending file sets has to survive the merge, and an
// explicit `false` in the extending file has to clear the base's `true`, as in
// tsc. A legacy field decorator is called with 3 arguments, a TC39 one with 2.
describe("tsconfig 'extends' decorator options", () => {
  const legacyFieldDecorator = `
    function d(..._args: any[]) { console.log("arguments:", arguments.length); }
    class A { @d x = 1; }
    new A();
  `;

  async function run(files: Record<string, string>, flags: string[] = []) {
    using dir = tempDir("tsconfig-extends-decorators", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "a.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test.concurrent.each([
    ["the extending file sets it and the base sets nothing", { experimentalDecorators: true }, {}, "arguments: 3"],
    [
      "the extending file sets it and the base sets another option",
      { experimentalDecorators: true },
      { strict: true },
      "arguments: 3",
    ],
    ["the base sets it and the extending file sets nothing", {}, { experimentalDecorators: true }, "arguments: 3"],
    ["both set it", { experimentalDecorators: true }, { experimentalDecorators: true }, "arguments: 3"],
    [
      "the extending file clears it",
      { experimentalDecorators: false },
      { experimentalDecorators: true },
      "arguments: 2",
    ],
    ["neither sets it", {}, {}, "arguments: 2"],
  ])("experimentalDecorators when %s", async (_, child, base, expected) => {
    const { stdout, stderr, exitCode } = await run({
      "a.ts": legacyFieldDecorator,
      "base.json": JSON.stringify({ compilerOptions: base }),
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: child }),
    });
    expect(stdout).toBe(expected);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("experimentalDecorators set in the extending file survives a chain of two bases", async () => {
    const { stdout, stderr, exitCode } = await run({
      "a.ts": legacyFieldDecorator,
      "root.json": JSON.stringify({ compilerOptions: { strict: true } }),
      "base.json": JSON.stringify({ extends: "./root.json", compilerOptions: { paths: {} } }),
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { experimentalDecorators: true } }),
    });
    expect(stdout).toBe("arguments: 3");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // --tsconfig-override names a file that extends the project's tsconfig.json (#30477).
  test.concurrent("experimentalDecorators set in the file --tsconfig-override names survives its extends", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "a.ts": legacyFieldDecorator,
        "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
        "tsconfig.bun.json": JSON.stringify({
          extends: "./tsconfig.json",
          compilerOptions: { experimentalDecorators: true },
        }),
      },
      ["--tsconfig-override", "./tsconfig.bun.json"],
    );
    expect(stdout).toBe("arguments: 3");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // The compiled program of --debug-aot takes its decorator options through another reader of tsconfig.json.
  test.concurrent.skipIf(!!aotUnsupported)(
    "experimentalDecorators set in the extending file survives for a compiled program",
    async () => {
      const { stdout, stderr, exitCode } = await run(
        {
          "a.ts": legacyFieldDecorator,
          "base.json": JSON.stringify({ compilerOptions: { strict: true } }),
          "tsconfig.json": JSON.stringify({
            extends: "./base.json",
            compilerOptions: { experimentalDecorators: true },
          }),
        },
        ["--debug-aot"],
      );
      expect(stdout).toBe("arguments: 3");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
    // The compile of a debug build under ASAN takes seconds.
    60_000,
  );

  // With emitDecoratorMetadata a decorated field gets a `design:type` entry.
  const metadataProbe = `
    function d(..._args: any[]) {}
    class A { @d x: number = 1; }
    console.log("metadata:", Reflect.getMetadata?.("design:type", A.prototype, "x")?.name ?? "none");
  `;
  const reflectShim = `
    const store = new Map();
    (Reflect as any).metadata = (key: string, value: any) => (target: any, name: string) => store.set(key + name, value);
    (Reflect as any).getMetadata = (key: string, _target: any, name: string) => store.get(key + name);
  `;

  test.concurrent.each([
    ["the extending file sets it", { emitDecoratorMetadata: true }, {}, "metadata: Number"],
    ["the base sets it", {}, { emitDecoratorMetadata: true }, "metadata: Number"],
    [
      "the extending file clears it",
      { emitDecoratorMetadata: false },
      { emitDecoratorMetadata: true },
      "metadata: none",
    ],
  ])("emitDecoratorMetadata when %s", async (_, child, base, expected) => {
    const { stdout, stderr, exitCode } = await run({
      "a.ts": reflectShim + metadataProbe,
      "base.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true, ...base } }),
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: child }),
    });
    expect(stdout).toBe(expected);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
