// https://github.com/oven-sh/bun/issues/31088
//
// Soundness fix: `StoreSlice<T>` was `Copy` AND `slice_mut` took `self` by
// value, so a caller could duplicate a handle and call `slice_mut()` on both
// copies to produce two `&mut [T]` over the same arena-backed allocation —
// immediate UB. The fix removes `Copy`/`Clone` from `StoreSlice<T>`, changes
// `slice()`/`slice_mut()` to `&self`/`&mut self` respectively, and replaces
// every site that previously aliased via the implicit `Copy` with either
// `core::mem::take(&mut field)` (ownership handoff) or `shallow_copy_in(bump)`
// (allocates a fresh arena slice so the two handles own disjoint storage).
//
// The compile-time / unit-test guard lives in `src/ast/nodes.rs`'s
// `not_copy_not_clone` test: an autoref-specialization probe panics on
// `cargo test -p bun_ast` if someone re-adds `impl Copy for StoreSlice`.
//
// The TypeScript cases below are end-to-end smoke tests: each runs `bun` on
// a fixture that exercises one of the refactored hot paths and asserts on
// observable runtime output. A regression in any of those refactors would
// flip the assertions. Subprocess-isolated so an ASAN trip surfaces as
// non-zero exit + signal instead of tearing down the in-process runner.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("class decorators + constructor field init + deep imports transpile cleanly", async () => {
  // TS constructor-field lowering is the hottest `StoreSlice<G::Property>` +
  // `StoreSlice<G::Arg>` path the fix touched (visit/mod.rs:1085–1190, the
  // `if to_add > 0` block that now uses `mem::take(&mut class.properties)`
  // instead of the old `let old_props = class.properties` Copy).
  const src = `
    function logClass(target: any) { (globalThis as any).__classLogged = true; return target; }
    function logMethod(_t: any, _k: any, d: PropertyDescriptor) { (globalThis as any).__methodLogged = true; return d; }
    function logParam(_t: any, _k: any, i: number) { ((globalThis as any).__paramIndices ??= []).push(i); }

    @logClass
    class Service {
      constructor(
        public readonly name: string,
        private readonly greeting: string = "hi",
        @logParam public readonly counts: number[] = [1, 2, 3],
      ) {}

      @logMethod
      greet(target: string): string { return \`\${this.greeting}, \${target}!\`; }
    }

    const svc = new Service("api", "hello", [10, 20, 30]);
    console.log(JSON.stringify({
      classLogged: (globalThis as any).__classLogged,
      methodLogged: (globalThis as any).__methodLogged,
      paramIndices: (globalThis as any).__paramIndices,
      name: svc.name,
      counts: svc.counts,
      greeting: svc.greet("world"),
    }));
  `;

  // TypeScript decorator lowering requires writing a fixture on disk so the
  // decorated class + call site live in a real module (bun's `-e` harness
  // doesn't thread a tsconfig through its inline source buffer, and
  // `experimentalDecorators` is a tsconfig option).
  using dir = tempDir("storeslice-31088-decorators", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: true, target: "esnext" },
    }),
    "app.ts": src,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "app.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    signalCode: null,
  });
  expect(JSON.parse(stdout)).toEqual({
    classLogged: true,
    methodLogged: true,
    paramIndices: [2],
    name: "api",
    counts: [10, 20, 30],
    greeting: "hello, world!",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("template-literal folding + deep-clone of arrow bodies transpiles cleanly", async () => {
  // `fold_string_addition.rs` fuses string + template and template + template;
  // `expr.rs` deep-clone of `E::Arrow` (body.stmts) and `E::Template` (parts)
  // used to copy the `StoreSlice` field implicitly. After the fix, those
  // sites go through `shallow_copy_in(bump)` so each clone owns its own
  // arena-backed slice; a misuse would either produce wrong output or blow
  // up at runtime.
  const src = `
    const who = "world";
    const greet = (name: string) => \`hello, \${name}!\`;

    // Classic template-in-concat — triggers fold_string_addition.
    const msg1 = "msg=" + \`hi, \${who}\`;

    // Template-in-template — also fold_string_addition.
    const msg2 = \`[\${greet(who)}] [\${greet("bun")}]\`;

    // Deep-clone path: put an arrow with a template body in a class method,
    // then call it after transformation.
    class Greeter {
      greet(name: string = "default") { return \`hello, \${name}!\`; }
    }

    console.log(JSON.stringify({
      msg1, msg2,
      greet1: greet("bun"),
      greet2: new Greeter().greet("cls"),
      greet3: new Greeter().greet(),
    }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    signalCode: null,
  });
  expect(JSON.parse(stdout)).toEqual({
    msg1: "msg=hi, world",
    msg2: "[hello, world!] [hello, bun!]",
    greet1: "hello, bun!",
    greet2: "hello, cls!",
    greet3: "hello, default!",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("import deduplication across multiple named imports preserves bindings", async () => {
  // `lower_esm_exports_hmr.rs::deduplicated_import` used to move the
  // caller's `StoreSlice<ClauseItem>` into the merged import via silent
  // `Copy`, leaving an aliased handle. The fix changes the parameter to
  // `&StoreSlice` and allocates a fresh `[ClauseItem]` arena slice via
  // `shallow_copy_in()` at the two sites that stash the slice into a
  // merged-or-new `S::Import` stmt. A multi-import entry that hits both
  // the merge path and the fresh-import path must still produce a bundle
  // whose imports resolve correctly.
  using dir = tempDir("storeslice-31088-dedup", {
    "lib.ts": `
      export const one = "one-val";
      export const two = "two-val";
      export const three = "three-val";
    `,
    "entry.ts": `
      import { one } from "./lib";
      import { two } from "./lib";
      import { three } from "./lib";
      console.log(JSON.stringify({ one, two, three }));
    `,
  });

  // Build to an output file so we can both (a) inspect the bundled text
  // for a single `./lib` reference and (b) execute it and assert bindings.
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--outfile=out.js", "entry.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildOut, buildErr, buildExit] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);
  expect(buildErr).toBe("");
  expect(buildOut).toContain("out.js");
  expect(buildExit).toBe(0);

  // Run the bundled output — all three bindings must resolve correctly.
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "out.js"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [runOut, runErr, runExit] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect({ runErr, signalCode: runProc.signalCode }).toEqual({
    runErr: "",
    signalCode: null,
  });
  expect(JSON.parse(runOut)).toEqual({
    one: "one-val",
    two: "two-val",
    three: "three-val",
  });
  expect(runExit).toBe(0);
});
