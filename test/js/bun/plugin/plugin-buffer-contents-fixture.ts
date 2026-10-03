// Fixture for plugins.test.ts.
//
//   bun plugin-buffer-contents-fixture.ts mutate <kind> <mutation>...
//   bun plugin-buffer-contents-fixture.ts worker <kind>
//   bun plugin-buffer-contents-fixture.ts order <kind>
//   bun plugin-buffer-contents-fixture.ts oom <kind>
//   bun plugin-buffer-contents-fixture.ts string
//
// Bun.plugin serves modules whose `contents` is a buffer. The transpiler reads
// the source until it has printed the module. JS runs in that time: a macro in
// the module, and the onResolve hooks of its imports. Another thread can write
// a SharedArrayBuffer at any time. Each mode changes the bytes in one of these
// ways, or shows when the bytes are taken. It prints one line of JSON.
import { plugin } from "bun";
import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { join } from "node:path";
import { isMainThread, Worker, workerData } from "node:worker_threads";
import { bytesOf, mutate, mutated } from "./plugin-buffer-contents-macro.ts";

const [mode, kind, ...rest] = process.argv.slice(2);
const macros = JSON.stringify(join(import.meta.dir, "plugin-buffer-contents-macro.ts"));
const encode = (text: string) => new TextEncoder().encode(text);

function fill<T extends ArrayBuffer | SharedArrayBuffer>(buffer: T, bytes: Uint8Array) {
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

// `contents` of each kind, holding `bytes`. The Uint8Array and the DataView
// are on a resizable ArrayBuffer, so that every mutation applies to them. The
// Buffer holds its bytes in its GC cell.
const kinds: Record<string, (bytes: Uint8Array) => ArrayBufferView | ArrayBuffer | SharedArrayBuffer> = {
  "Buffer": bytes => Buffer.alloc(bytes.length).fill(bytes),
  "Uint8Array": bytes => new Uint8Array(fill(new ArrayBuffer(bytes.length, { maxByteLength: bytes.length }), bytes)),
  "DataView": bytes => new DataView(fill(new ArrayBuffer(bytes.length, { maxByteLength: bytes.length }), bytes)),
  "ArrayBuffer": bytes => fill(new ArrayBuffer(bytes.length), bytes),
  "resizable ArrayBuffer": bytes => fill(new ArrayBuffer(bytes.length, { maxByteLength: bytes.length }), bytes),
  "SharedArrayBuffer": bytes => fill(new SharedArrayBuffer(bytes.length), bytes),
  "growable SharedArrayBuffer": bytes =>
    fill(new SharedArrayBuffer(bytes.length, { maxByteLength: bytes.length * 2 }), bytes),
};
const make = (text: string) => (globalThis.contents = kinds[kind](encode(text)));

const results: Record<string, unknown> = {};
const failure = (e: unknown) => ({ error: String((e as Error)?.message ?? e).split("\n")[0] });

if (mode === "mutate") {
  // The source of the module at `<by>/<how>/<n>`. `by` is what runs
  // mutate(how) while the transpiler reads this source.
  const moduleSource = (path: string) => {
    const [by, how] = path.split("/");
    return make(
      (by === "macro"
        ? `import { mutate } from ${macros} with { type: "macro" };\nexport const during = mutate(${JSON.stringify(how)});\n`
        : `import { during } from "mutate:${path}";\nexport { during };\n`) +
        `export const after = "after the mutation";\n`,
    );
  };

  const cells: { cell: string; how: string; load: () => Promise<any> | any }[] = [];
  plugin({
    name: "buffer contents",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "sync" }, ({ path }) => ({ path, namespace: "sync" }));
      build.onResolve({ filter: /.*/, namespace: "async" }, ({ path }) => ({ path, namespace: "async" }));
      build.onLoad({ filter: /.*/, namespace: "sync" }, ({ path }) => ({ contents: moduleSource(path), loader: "ts" }));
      build.onLoad({ filter: /.*/, namespace: "async" }, async ({ path }) => {
        await 1;
        return { contents: moduleSource(path), loader: "ts" };
      });

      // The transpiler resolves the imports of a module after it has parsed the module and before it prints it.
      build.onResolve({ filter: /.*/, namespace: "mutate" }, ({ path }) => {
        mutate(path.split("/")[1]);
        return { path, namespace: "mutate" };
      });
      build.onLoad({ filter: /.*/, namespace: "mutate" }, ({ path }) => ({
        contents: `export const during = ${JSON.stringify(path.split("/")[1])};`,
        loader: "js",
      }));

      for (const how of rest) {
        for (const by of ["macro", "onResolve"]) {
          const path = () => `${by}/${how}/${cells.length}`;
          const module = () => {
            const specifier = `module-${cells.length}`;
            const source = path();
            build.module(specifier, () => ({ contents: moduleSource(source), loader: "ts" }));
            return specifier;
          };
          const forms: [string, () => string, "import" | "require"][] = [
            ["onLoad import", () => "sync:" + path(), "import"],
            ["onLoad require", () => "sync:" + path(), "require"],
            ["async onLoad import", () => "async:" + path(), "import"],
            ["build.module import", module, "import"],
            ["build.module require", module, "require"],
          ];
          for (const [form, specifierOf, through] of forms) {
            const specifier = specifierOf();
            cells.push({
              cell: `${how} by ${by}, ${form}`,
              how,
              load: () => (through === "import" ? import(specifier) : require(specifier)),
            });
          }
        }
      }
    },
  });

  for (const { cell, how, load } of cells) {
    try {
      const { during, after } = await load();
      results[cell] = { during, after, mutated: mutated(how) };
    } catch (e) {
      results[cell] = failure(e);
    }
  }
} else if (mode === "worker") {
  // A worker flips the `_` separators of the numeric literals in the source to
  // `0` and back. The lexer counts the separators of a literal, allocates
  // `length - count` bytes, then copies every byte that is not a `_`. A
  // transpiler that reads the shared bytes in place aborts the process when a
  // separator turns into a digit between the two passes, and gives the literal
  // a wrong value when a digit turns into a separator. One that reads a
  // private copy sees one value per byte, and every value of a byte gives a
  // valid module.
  const literals = 64;
  const literal = "  1_000_000_000_000_000,\n";
  const base = encode("export default [\n" + Buffer.alloc(literals * literal.length, literal).toString() + "];\n");
  // Each separator that reads as `0` makes the literal ten times larger.
  const values = new Set([1e15, 1e16, 1e17, 1e18, 1e19, 1e20]);
  const imports = 50;

  if (isMainThread) {
    const shared = fill(new SharedArrayBuffer(base.length), base);
    // The number of passes the worker has made over the bytes it flips.
    const passes = new Int32Array(new SharedArrayBuffer(4));
    new Worker(new URL(import.meta.url), { workerData: { shared, passes }, argv: [mode, kind] }).unref();

    // The worker's events cannot reach this thread while it imports in a
    // loop, so a worker that stopped shows only as a pass count that stands still.
    const workerStopped = (): never => {
      console.error("the worker made no pass over the bytes for 10 s");
      process.exit(1);
    };
    if (Atomics.wait(passes, 0, 0, 10_000) === "timed-out") workerStopped();

    const contents = kind === "Uint8Array" ? new Uint8Array(shared) : shared;
    plugin({
      name: "shared contents",
      setup(build) {
        build.onResolve({ filter: /.*/, namespace: "shared" }, ({ path }) => ({ path, namespace: "shared" }));
        build.onLoad({ filter: /.*/, namespace: "shared" }, () => ({ contents, loader: "ts" }));
      },
    });

    // Count an import only when the worker made a pass while it ran. A debug
    // build is slow enough that every import counts. A release build can
    // finish many imports before the worker's thread gets a core of its own.
    let seen = Atomics.load(passes, 0);
    let progressAt = performance.now();
    let overlapped = 0;
    for (let total = 0; overlapped < imports; total++) {
      const { default: exported } = await import("shared:" + total);
      if (exported.length !== literals || !exported.every((value: number) => values.has(value))) {
        results.wrong = "import " + total + " gave " + JSON.stringify(exported);
        break;
      }

      const now = Atomics.load(passes, 0);
      if (now !== seen) {
        seen = now;
        overlapped++;
        progressAt = performance.now();
      } else if (performance.now() - progressAt > 10_000) {
        workerStopped();
      }
    }
    results.overlapped = overlapped;
  } else {
    const { shared, passes } = workerData as { shared: SharedArrayBuffer; passes: Int32Array };
    const bytes = new Uint8Array(shared);
    const separators: number[] = [];
    for (let i = 0; i < base.length; i++) {
      if (base[i] === 0x5f) separators.push(i);
    }

    // `Atomics.store` so that the compiler keeps every store and the other thread sees each one.
    for (;;) {
      for (const at of separators) Atomics.store(bytes, at, 0x30);
      for (const at of separators) Atomics.store(bytes, at, 0x5f);
      if (Atomics.add(passes, 0, 1) === 0) Atomics.notify(passes, 0);
    }
  }
} else if (mode === "order") {
  // The transpiler gets the bytes that `contents` holds after the whole result
  // of the plugin was read, and a load leaves the buffer as it was.
  const first = `export const which = "first ";\n`;
  const second = encode(`export const which = "second";\n`);
  const rewrite = () => bytesOf(globalThis.contents as ArrayBuffer).set(second);

  // One buffer for every module of the "scratch" namespace, as a plugin that avoids allocations has.
  const scratch = kinds[kind](new Uint8Array(64).fill(0x20));
  const detachedBuffer = new ArrayBuffer(8);
  const detachedView = new Uint8Array(detachedBuffer);
  detachedBuffer.transfer();

  plugin({
    name: "when the bytes are taken",
    setup(build) {
      for (const namespace of ["getter", "settled", "scratch", "empty"]) {
        build.onResolve({ filter: /.*/, namespace }, ({ path }) => ({ path, namespace }));
      }
      // `loader` is read before `contents`.
      build.onLoad({ filter: /.*/, namespace: "getter" }, () => ({
        contents: make(first),
        get loader() {
          rewrite();
          return "ts";
        },
      }));
      // The promise is pending when onLoad returns. The bytes change after the
      // promise is resolved and before its reaction runs.
      build.onLoad({ filter: /.*/, namespace: "settled" }, () => {
        const { promise, resolve } = Promise.withResolvers<{ contents: unknown; loader: string }>();
        queueMicrotask(() => {
          resolve({ contents: make(first), loader: "ts" });
          rewrite();
        });
        return promise;
      });
      build.onLoad({ filter: /.*/, namespace: "scratch" }, ({ path }) => {
        const bytes = bytesOf(scratch);
        bytes.fill(0x20);
        bytes.set(encode(`export const which = ${JSON.stringify(path)};`));
        return { contents: scratch, loader: "ts" };
      });
      build.onLoad({ filter: /.*/, namespace: "empty" }, ({ path }) => ({
        contents:
          path === "zero length"
            ? kinds[kind](new Uint8Array(0))
            : ArrayBuffer.isView(scratch)
              ? detachedView
              : detachedBuffer,
        loader: "ts",
      }));
    },
  });

  try {
    results["loader getter"] = (await import("getter:m")).which;
    results["promise reaction"] = (await import("settled:m")).which;
    results["scratch"] = [(await import("scratch:one")).which, require("scratch:two").which];
    results["scratch after the loads"] = {
      byteLength: scratch.byteLength,
      text: new TextDecoder().decode(bytesOf(scratch)).trimEnd(),
    };
    results["zero length"] = Object.keys(await import("empty:zero length"));
    results["detached"] = Object.keys(await import("empty:detached"));
  } catch (e) {
    results.failure = failure(e);
  }
} else if (mode === "oom") {
  // The copy of the bytes is larger than what can be allocated.
  const limit = 1024 * 1024;
  const tooLarge = kinds[kind](new Uint8Array(limit + 1).fill(0x20));
  plugin({
    name: "contents that cannot be copied",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "large" }, ({ path }) => ({ path, namespace: "large" }));
      build.onLoad({ filter: /^sync/, namespace: "large" }, () => ({ contents: tooLarge, loader: "ts" }));
      build.onLoad({ filter: /^async/, namespace: "large" }, async () => {
        await 1;
        return { contents: tooLarge, loader: "ts" };
      });
      build.module("large-module", () => ({ contents: tooLarge, loader: "ts" }));
    },
  });

  const attempt = async (load: () => unknown) => {
    try {
      return Object.keys((await load()) as object);
    } catch (e) {
      return `${(e as Error).name}: ${(e as Error).message}`;
    }
  };
  const previous = setSyntheticAllocationLimitForTesting(limit);
  results["onLoad import"] = await attempt(() => import("large:sync 1"));
  results["onLoad require"] = await attempt(() => require("large:sync 2"));
  results["async onLoad import"] = await attempt(() => import("large:async"));
  results["build.module require"] = await attempt(() => require("large-module"));
  setSyntheticAllocationLimitForTesting(previous);
  results["with the limit lifted"] = await attempt(() => import("large:sync 3"));
} else if (mode === "string") {
  // The transpiler reads a string where it is. A macro drops every reference
  // that JS has to the string, then collects.
  const literals = Array.from({ length: 16 }, (_, i) => `a string literal that the printer reads back, number ${i}`);
  const text = () =>
    [
      `import { collect } from ${macros} with { type: "macro" };`,
      `export const during = collect();`,
      `export const after = ${JSON.stringify(literals)};`,
      // About the size of the strings that collect() allocates.
      `// ${Buffer.alloc(2048, "padding ").toString()}`,
    ].join("\n");
  const head = "// " + Buffer.alloc(512, "x").toString() + "\n";
  const tail = "\n// tail";
  const strings: Record<string, () => string> = {
    flat: text,
    rope: () => {
      const whole = text();
      return whole.slice(0, 200) + whole.slice(200);
    },
    substring: () => (head + text() + tail).slice(head.length, -tail.length),
  };

  plugin({
    name: "string contents",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "string" }, ({ path }) => ({ path, namespace: "string" }));
      build.onLoad({ filter: /.*/, namespace: "string" }, ({ path }) => {
        globalThis.contents = strings[path]();
        return (globalThis.result = { contents: globalThis.contents, loader: "ts" });
      });
    },
  });

  for (const name of Object.keys(strings)) {
    try {
      const { during, after } = await import("string:" + name);
      results[name] = { during, intact: JSON.stringify(after) === JSON.stringify(literals) };
    } catch (e) {
      results[name] = failure(e);
    }
  }
}

if (isMainThread) {
  console.log(JSON.stringify(results));
  process.exit(0);
}
