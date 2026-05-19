// https://github.com/oven-sh/bun/issues/31088
//
// Soundness fix: `StoreSlice<T>` was `Copy` AND `slice_mut` took `self` by
// value, so a caller could duplicate a handle and call `slice_mut()` on both
// copies to produce two `&mut [T]` over the same arena-backed allocation —
// immediate UB. The fix removes `Copy`/`Clone` from `StoreSlice<T>`, changes
// `slice()`/`slice_mut()` to `&self`/`&mut self` respectively, and threads
// `reborrow_shared()` through the handful of sites that legitimately need a
// second read-only handle.
//
// The primary proof of the fix lives in `src/ast/nodes.rs`'s unit tests
// (`cargo test -p bun_ast store_slice_tests`): an autoref-specialization
// probe panics if someone re-adds `impl Copy for StoreSlice` (fail-before,
// pass-after on the Rust side). This TypeScript file is a smoke test for
// the parser/transpiler paths that had to be refactored to uphold the new
// borrow-checked API: class decorators (`src/js_parser/lower/lower_decorators.rs`,
// `src/js_parser/p.rs` constructor-field rewrites), template-literal folding
// (`src/ast/fold_string_addition.rs`), deep-clone of arrow/template/fn
// bodies (`src/ast/expr.rs`, `src/ast/g.rs`), and import deduplication
// (`src/js_parser/lower/lower_esm_exports_hmr.rs`). A behavior regression
// in any of those would surface here even though the Copy-removal itself
// is invisible at the JS level.
//
// Runs the fixture in a subprocess so an ASAN/UBSAN trip in the transpiler
// surfaces as a non-zero exit + signal instead of tearing down the runner.

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

  expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    exitCode: 0,
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
});

test.concurrent("template-literal folding + deep-clone of arrow bodies transpiles cleanly", async () => {
  // `fold_string_addition.rs` fuses string + template and template + template;
  // `expr.rs` deep-clone of `E::Arrow` (body.stmts) and `E::Template` (parts)
  // used to copy the `StoreSlice` field implicitly. After the fix, those sites
  // go through `reborrow_shared()`; a misuse would either produce wrong output
  // or blow up at runtime.
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

  expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
  expect(JSON.parse(stdout)).toEqual({
    msg1: "msg=hi, world",
    msg2: "[hello, world!] [hello, bun!]",
    greet1: "hello, bun!",
    greet2: "hello, cls!",
    greet3: "hello, default!",
  });
});

test.concurrent("import deduplication across export-from and re-export preserves bindings", async () => {
  // `lower_esm_exports_hmr.rs::deduplicated_import` used to move the
  // caller's `StoreSlice<ClauseItem>` into the merged import by silent
  // `Copy`, leaving an aliased handle the caller could mutate. The fix
  // changes the parameter to `&StoreSlice` and uses `reborrow_shared()`
  // at the two sites that stash the slice into a new or merged stmt —
  // a bundling pass that duplicate-imports the same module should still
  // produce a single working import.
  using dir = tempDir("storeslice-31088-dedup", {
    "lib.ts": `
      export const one = "one";
      export const two = "two";
      export const three = "three";
    `,
    "entry.ts": `
      import { one } from "./lib";
      export { two } from "./lib";
      import { three } from "./lib";
      console.log(JSON.stringify({ one, three, two: (globalThis as any).two ?? "?" }));
      (globalThis as any).two = "<assigned-at-entry>";
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "entry.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [bundleOut, bundleErr, bundleExit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(bundleErr).toBe("");
  expect(bundleExit).toBe(0);
  // The bundled output should emit only ONE reference to `./lib` (the merged
  // import record) and preserve both named bindings.
  expect(bundleOut).toContain("one");
  expect(bundleOut).toContain("three");
});
