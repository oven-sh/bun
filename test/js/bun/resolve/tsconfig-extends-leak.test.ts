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

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import fs from "node:fs";
import path from "path";

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

// tsconfig "extends" accepts package specifiers (tsc resolves them against
// node_modules, walking up parent directories), and the package config may
// itself extend another file. The chained compilerOptions must apply: here
// experimentalDecorators (legacy decorator call signature) and
// emitDecoratorMetadata (design:* metadata emission) live in the base config.
test("tsconfig 'extends' resolves package specifiers from node_modules", async () => {
  using dir = tempDir("tsconfig-extends-package", {
    "node_modules/fake-tsconfig/package.json": JSON.stringify({ name: "fake-tsconfig", version: "1.0.0" }),
    // Layered like @adonisjs/tsconfig: the entry config extends a sibling
    // base config inside the package, and the flags live only in the base.
    "node_modules/fake-tsconfig/tsconfig.app.json": JSON.stringify({ extends: "./flags.json" }),
    "node_modules/fake-tsconfig/flags.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    }),
    "tsconfig.json": JSON.stringify({ extends: "fake-tsconfig/tsconfig.app.json" }),
    "index.ts": `
      (Reflect as any).metadata = (key: string, value: any) => (target: any, prop: any) => {
        if (key === "design:type") console.log("design:type:", value.name);
      };
      function dec(target: unknown, key?: unknown) {
        console.log("decorator args:", typeof target, typeof key);
      }
      class Foo {
        @dec name!: string;
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Legacy decorators receive (prototype, key); TC39 would be (undefined, context).
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "design:type: String\ndecorator args: object string\n",
    stderr: "",
    exitCode: 0,
  });
});

// TypeScript 5 allows "extends" to be an array. Each entry is resolved like a
// single-string extends (relative or package specifier), and later entries
// override earlier ones. The leaf config overrides all of them.
test("tsconfig 'extends' accepts an array of base configs", async () => {
  using dir = tempDir("tsconfig-extends-array", {
    "lib/a/mod.ts": `export default "A";`,
    "lib/b/mod.ts": `export default "B";`,
    "a.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/a/*"] } } }),
    "b.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/b/*"] } } }),
    // paths is defined in both entries; the later one wins.
    "tsconfig.json": JSON.stringify({ extends: ["./a.json", "./b.json"] }),
    "index.ts": `import x from "@lib/mod"; console.log(x);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "B\n", stderr: "", exitCode: 0 });
});

test("tsconfig 'extends' array entries may be package specifiers", async () => {
  using dir = tempDir("tsconfig-extends-array-pkg", {
    "lib/mod.ts": `export default "LIB";`,
    "node_modules/@tsc/base/package.json": JSON.stringify({ name: "@tsc/base", version: "1.0.0" }),
    "node_modules/@tsc/base/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@lib/*": ["../../../lib/*"] } },
    }),
    "local.json": JSON.stringify({ compilerOptions: { jsx: "react" } }),
    "tsconfig.json": JSON.stringify({ extends: ["@tsc/base", "./local.json"] }),
    "index.ts": `import x from "@lib/mod"; console.log(x);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "LIB\n", stderr: "", exitCode: 0 });
});

// The merge loop must carry experimentalDecorators from every config in the
// chain, not just the one the merge starts from. With array extends, the
// second entry is merged (not used as the starting config), so a flag set
// only there exercises the merge path. No emitDecoratorMetadata here: that
// flag alone already implies legacy semantics and would mask the bug.
test("tsconfig 'extends' array merges experimentalDecorators from a non-first entry", async () => {
  using dir = tempDir("tsconfig-extends-array-decorators", {
    "paths.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/*"] } } }),
    "decorators.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
    "tsconfig.json": JSON.stringify({ extends: ["./paths.json", "./decorators.json"] }),
    "index.ts": `
      function dec(target: unknown, key?: unknown) {
        console.log("decorator args:", typeof target, typeof key);
      }
      class Foo {
        @dec name!: string;
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Legacy decorators receive (prototype, key); TC39 would be (undefined, context).
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "decorator args: object string\n",
    stderr: "",
    exitCode: 0,
  });
});

// One unresolvable array entry must not drop the entries next to it.
test("tsconfig 'extends' array keeps siblings when one entry is missing", async () => {
  using dir = tempDir("tsconfig-extends-array-missing", {
    "lib/mod.ts": `export default "OK";`,
    "real.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/*"] } } }),
    "tsconfig.json": JSON.stringify({ extends: ["./missing.json", "./real.json"] }),
    "index.ts": `import x from "@lib/mod"; console.log(x);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
});

// The common NestJS/TypeORM shape: the leaf sets experimentalDecorators and
// extends a base. The merge starts from the base, so the leaf's flag must be
// carried over by the merge loop, not just flags from the starting config.
test("tsconfig 'extends' keeps experimentalDecorators set in the extending config", async () => {
  using dir = tempDir("tsconfig-extends-leaf-decorators", {
    "base.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/*"] } } }),
    "tsconfig.json": JSON.stringify({
      extends: "./base.json",
      compilerOptions: { experimentalDecorators: true },
    }),
    "index.ts": `
      function dec(target: unknown, key?: unknown) {
        console.log("decorator args:", typeof target, typeof key);
      }
      class Foo {
        @dec name!: string;
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Legacy decorators receive (prototype, key); TC39 would be (undefined, context).
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "decorator args: object string\n",
    stderr: "",
    exitCode: 0,
  });
});

// A relative extends that points into node_modules follows the target's own
// extends chain, same as a package specifier would (tsc behavior).
test("tsconfig 'extends' via relative path into node_modules follows the chain", async () => {
  using dir = tempDir("tsconfig-extends-relative-nm", {
    "node_modules/pkg/app.json": JSON.stringify({ extends: "./flags.json" }),
    "node_modules/pkg/flags.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: true },
    }),
    "tsconfig.json": JSON.stringify({ extends: "./node_modules/pkg/app.json" }),
    "index.ts": `
      function dec(target: unknown, key?: unknown) {
        console.log("decorator args:", typeof target, typeof key);
      }
      class Foo {
        @dec name!: string;
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "decorator args: object string\n",
    stderr: "",
    exitCode: 0,
  });
});

// "extends": "base.json" without "./" resolved relative to the tsconfig
// before the node_modules walk existed; the walk misses and the relative
// fallback must keep that shape working.
test("tsconfig 'extends' bare sibling file name still resolves relative", async () => {
  using dir = tempDir("tsconfig-extends-bare-relative", {
    "lib/mod.ts": `export default "BARE";`,
    "base.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/*"] } } }),
    "tsconfig.json": JSON.stringify({ extends: "base.json" }),
    "index.ts": `import x from "@lib/mod"; console.log(x);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "BARE\n", stderr: "", exitCode: 0 });
});

// tsc appends ".json" to extension-less extends targets.
test("tsconfig 'extends' appends .json to an extension-less relative target", async () => {
  using dir = tempDir("tsconfig-extends-json-retry", {
    "lib/mod.ts": `export default "RETRY";`,
    "tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/*"] } } }),
    "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base" }),
    "index.ts": `import x from "@lib/mod"; console.log(x);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "RETRY\n", stderr: "", exitCode: 0 });
});

// Workspace config packages are installed as symlinks. The resolved config
// must be realpath'd so its relative paths entries are interpreted from the
// package's real location, matching tsc and esbuild.
test("tsconfig 'extends' package specifier resolves through a symlink", async () => {
  using dir = tempDir("tsconfig-extends-symlink", {
    "packages/cfg/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@shared/*": ["../shared/*"] } },
    }),
    "packages/shared/mod.ts": `export default "SHARED";`,
    "app/tsconfig.json": JSON.stringify({ extends: "@repo/cfg/tsconfig.json" }),
    "app/index.ts": `import x from "@shared/mod"; console.log(x);`,
  });
  fs.mkdirSync(path.join(String(dir), "app/node_modules/@repo"), { recursive: true });
  fs.symlinkSync(
    path.join(String(dir), "packages/cfg"),
    path.join(String(dir), "app/node_modules/@repo/cfg"),
    "junction",
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: path.join(String(dir), "app"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "SHARED\n", stderr: "", exitCode: 0 });
});
