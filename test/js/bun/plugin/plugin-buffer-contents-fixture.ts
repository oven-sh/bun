// Fixture for plugins.test.ts.
//
//   bun plugin-buffer-contents-fixture.ts mutate '{"<kind>": ["<mutation>", ...], ...}'
//   bun plugin-buffer-contents-fixture.ts order <kind>...
//   bun plugin-buffer-contents-fixture.ts limit <kind>...
//   bun plugin-buffer-contents-fixture.ts string
//   bun plugin-buffer-contents-fixture.ts worker <kind>
//   bun plugin-buffer-contents-fixture.ts cache <kind>
//
// Bun.plugin serves modules whose `contents` is a buffer or a string. The
// transpiler reads the source until it has printed the module. A macro in the
// module runs JS in that time, and another thread can write a
// SharedArrayBuffer at any time. Each mode changes the source in one of these
// ways, or shows when the bytes are taken. It prints one line of JSON.
import { plugin } from "bun";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { bytesOf, mutated } from "./plugin-buffer-contents-macro.ts";

const [mode, ...args] = process.argv.slice(2);
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
const make = (kind: string, text: string) => (globalThis.contents = kinds[kind](encode(text)));

const results: Record<string, unknown> = {};
const failure = (e: unknown) => ({ error: String((e as Error)?.message ?? e).split("\n")[0] });

// The "worker" and "cache" modes start this file again as a worker that writes
// a SharedArrayBuffer in a loop, while this thread imports modules that a
// plugin serves from those bytes.

// The worker's events cannot reach this thread while it imports in a loop, so
// a worker that stopped shows only as a pass count that stands still.
function writerStopped(): never {
  console.error("the worker made no pass over the bytes for 10 s");
  process.exit(1);
}

// Returns the count of passes that the worker made over `shared`. It is not zero when this returns.
function startWriter(shared: SharedArrayBuffer) {
  const passes = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(import.meta.url, { argv: [mode, ...args] });
  worker.unref();
  worker.postMessage({ shared, passes });
  if (Atomics.wait(passes, 0, 0, 10_000) === "timed-out") writerStopped();
  return passes;
}

// In the worker: calls `write(bytes, pass)` for ever.
function writeForEver(write: (bytes: Uint8Array, pass: number) => void) {
  self.onmessage = ({ data }: MessageEvent<{ shared: SharedArrayBuffer; passes: Int32Array }>) => {
    const bytes = new Uint8Array(data.shared);
    for (let pass = 0; ; pass++) {
      write(bytes, pass);
      if (Atomics.add(data.passes, 0, 1) === 0) Atomics.notify(data.passes, 0);
    }
  };
}

// Calls `load(n)` until `count` of the loads had the worker make a pass while
// they ran, or until one returns false. A debug build is slow enough that
// every load counts. A release build can finish many loads before the
// worker's thread gets a core of its own.
async function loadWhileWritten(passes: Int32Array, count: number, load: (n: number) => Promise<boolean>) {
  let seen = Atomics.load(passes, 0);
  let progressAt = performance.now();
  let overlapped = 0;
  for (let n = 0; overlapped < count && (await load(n)); n++) {
    const now = Atomics.load(passes, 0);
    if (now !== seen) {
      seen = now;
      overlapped++;
      progressAt = performance.now();
    } else if (performance.now() - progressAt > 10_000) {
      writerStopped();
    }
  }
  results.overlapped = overlapped;
}

if (mode === "mutate") {
  const table: Record<string, string[]> = JSON.parse(args[0]);
  const kindNames = Object.keys(table);

  // The source of the module at `<index of the kind>/<how>/<n>`. The macro
  // runs mutate(how) while the transpiler reads this source.
  const moduleSource = (path: string) => {
    const [kind, how] = path.split("/");
    return make(
      kindNames[Number(kind)],
      `import { mutate } from ${macros} with { type: "macro" };\n` +
        `export const during = mutate(${JSON.stringify(how)});\n` +
        `export const after = "after the mutation";\n`,
    );
  };

  const cells: { kind: string; cell: string; how: string; load: () => Promise<any> | any }[] = [];
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

      kindNames.forEach((kind, index) => {
        for (const how of table[kind]) {
          const path = () => `${index}/${how}/${cells.length}`;
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
              kind,
              cell: `${how}, ${form}`,
              how,
              load: () => (through === "import" ? import(specifier) : require(specifier)),
            });
          }
        }
      });
    },
  });

  for (const { kind, cell, how, load } of cells) {
    const ofKind = (results[kind] ??= {}) as Record<string, unknown>;
    try {
      const { during, after } = await load();
      ofKind[cell] = { during, after, mutated: mutated(how) };
    } catch (e) {
      ofKind[cell] = failure(e);
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

  if (Bun.isMainThread) {
    const shared = fill(new SharedArrayBuffer(base.length), base);
    const passes = startWriter(shared);
    const contents = args[0] === "Uint8Array" ? new Uint8Array(shared) : shared;
    plugin({
      name: "shared contents",
      setup(build) {
        build.onResolve({ filter: /.*/, namespace: "shared" }, ({ path }) => ({ path, namespace: "shared" }));
        build.onLoad({ filter: /.*/, namespace: "shared" }, () => ({ contents, loader: "ts" }));
      },
    });

    // An unfixed build fails within 10 imports.
    await loadWhileWritten(passes, 20, async n => {
      const { default: exported } = await import("shared:" + n);
      if (exported.length === literals && exported.every((value: number) => values.has(value))) return true;
      results.wrong = "import " + n + " gave " + JSON.stringify(exported);
      return false;
    });
  } else {
    const separators: number[] = [];
    for (let i = 0; i < base.length; i++) {
      if (base[i] === 0x5f) separators.push(i);
    }
    // `Atomics.store` so that the compiler keeps every store and the other thread sees each one.
    writeForEver(bytes => {
      for (const at of separators) Atomics.store(bytes, at, 0x30);
      for (const at of separators) Atomics.store(bytes, at, 0x5f);
    });
  }
} else if (mode === "cache") {
  // The transpiler cache stores the output of a module under the hash of its
  // source, and a source with the same bytes gets that output in every later
  // load, in this process and in later ones. A worker switches one character
  // of the last string literal of the source between `1` and `2`. A
  // transpiler that reads the shared bytes in place hashes the source, and
  // prints the literal from the source when it has parsed the rest, so it can
  // hash one character and print the other. This mode needs
  // BUN_RUNTIME_TRANSPILER_CACHE_PATH, and a source of 4 KiB or more, which
  // is the least that the cache stores.
  const roundOf = (round: number) => String(round).padStart(6, "0");
  const padding = Buffer.alloc(4096, "padding ").toString();
  const numbers = Array.from({ length: 512 }, (_, i) => i).join(",");
  const head = (round: number) =>
    `// ${roundOf(round)} ${padding}\nexport const numbers = [${numbers}];\nexport const value = "`;
  const sourceOf = (round: number, digit: number) => `${head(round)}${digit}";\n`;
  const roundAt = "// ".length;
  const digitAt = head(0).length;

  if (Bun.isMainThread) {
    const shared = fill(new SharedArrayBuffer(sourceOf(0, 1).length), encode(sourceOf(0, 1)));
    const bytes = new Uint8Array(shared);
    const passes = startWriter(shared);
    const contents = args[0] === "Uint8Array" ? bytes : shared;
    plugin({
      name: "cached contents",
      setup(build) {
        build.onResolve({ filter: /.*/, namespace: "written" }, ({ path }) => ({ path, namespace: "written" }));
        build.onLoad({ filter: /.*/, namespace: "written" }, ({ path }) => {
          // The worker writes the digit. Only this thread writes the round, which gives each load a source of its own.
          bytes.set(encode(path), roundAt);
          return { contents, loader: "ts" };
        });
        build.onResolve({ filter: /.*/, namespace: "still" }, ({ path }) => ({ path, namespace: "still" }));
        build.onLoad({ filter: /.*/, namespace: "still" }, ({ path }) => {
          const [round, digit] = path.split("/").map(Number);
          return { contents: sourceOf(round, digit), loader: "ts" };
        });
      },
    });

    const wrong: string[] = [];
    // On an unfixed build about a third of the loads leave a wrong entry.
    await loadWhileWritten(passes, 16, async n => {
      const { value } = await import("written:" + roundOf(n));
      // The load printed `value`. If it hashed the other digit, the source
      // with the other digit now has the output of this one in the cache.
      const other = value === "1" ? 2 : 1;
      const { value: cached } = await import(`still:${n}/${other}`);
      if (cached !== String(other)) wrong.push(`the source of load ${n} with ${other} gave ${cached}`);
      return true;
    });
    results.wrong = wrong;
    results.entries = readdirSync(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH!).length > 0;
  } else {
    writeForEver((bytes, pass) => Atomics.store(bytes, digitAt, 0x31 + (pass & 1)));
  }
} else if (mode === "order") {
  // The transpiler gets the bytes that `contents` holds after the whole result
  // of the plugin was read, and a load leaves the buffer as it was. The path
  // of each module is `<kind>/<name>`.
  const first = `export const which = "first ";\n`;
  const second = encode(`export const which = "second";\n`);
  const rewrite = () => bytesOf(globalThis.contents as ArrayBuffer).set(second);

  // One buffer of each kind for every module of the "scratch" namespace, as a plugin that avoids allocations has.
  const scratch = Object.fromEntries(args.map(kind => [kind, kinds[kind](new Uint8Array(64).fill(0x20))]));
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
      build.onLoad({ filter: /.*/, namespace: "getter" }, ({ path }) => ({
        contents: make(path.split("/")[0], first),
        get loader() {
          rewrite();
          return "ts";
        },
      }));
      // The promise is pending when onLoad returns. The bytes change after the
      // promise is resolved and before its reaction runs.
      build.onLoad({ filter: /.*/, namespace: "settled" }, ({ path }) => {
        const { promise, resolve } = Promise.withResolvers<{ contents: unknown; loader: string }>();
        queueMicrotask(() => {
          resolve({ contents: make(path.split("/")[0], first), loader: "ts" });
          rewrite();
        });
        return promise;
      });
      build.onLoad({ filter: /.*/, namespace: "scratch" }, ({ path }) => {
        const [kind, name] = path.split("/");
        const bytes = bytesOf(scratch[kind]);
        bytes.fill(0x20);
        bytes.set(encode(`export const which = ${JSON.stringify(name)};`));
        return { contents: scratch[kind], loader: "ts" };
      });
      build.onLoad({ filter: /.*/, namespace: "empty" }, ({ path }) => {
        const [kind, name] = path.split("/");
        const detached = ArrayBuffer.isView(scratch[kind]) ? detachedView : detachedBuffer;
        return { contents: name === "zero length" ? kinds[kind](new Uint8Array(0)) : detached, loader: "ts" };
      });
    },
  });

  for (const kind of args) {
    try {
      results[kind] = {
        "loader getter": (await import(`getter:${kind}/m`)).which,
        "promise reaction": (await import(`settled:${kind}/m`)).which,
        "scratch": [(await import(`scratch:${kind}/one`)).which, require(`scratch:${kind}/two`).which],
        "scratch after the loads": {
          byteLength: scratch[kind].byteLength,
          text: new TextDecoder().decode(bytesOf(scratch[kind])).trimEnd(),
        },
        "zero length": Object.keys(await import(`empty:${kind}/zero length`)),
        "detached": Object.keys(await import(`empty:${kind}/detached`)),
      };
    } catch (e) {
      results[kind] = failure(e);
    }
  }
} else if (mode === "limit") {
  // A parser takes a source of less than 2 GiB. The pages of this buffer are never written or read.
  const buffer = new ArrayBuffer(2 ** 31);
  const contents: Record<string, ArrayBufferView | ArrayBuffer> = {
    "Uint8Array": new Uint8Array(buffer),
    "ArrayBuffer": buffer,
  };
  plugin({
    name: "contents of 2 GiB",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "limit" }, ({ path }) => ({ path, namespace: "limit" }));
      build.onLoad({ filter: /.*/, namespace: "limit" }, ({ path }) => ({
        contents: contents[path.split("/")[0]],
        loader: "ts",
      }));
    },
  });

  for (const kind of args) {
    const ofKind: Record<string, unknown> = (results[kind] = {});
    ofKind.import = await import(`limit:${kind}/import`).then(() => "loaded", failure);
    try {
      require(`limit:${kind}/require`);
      ofKind.require = "loaded";
    } catch (e) {
      ofKind.require = failure(e);
    }
  }
} else if (mode === "string") {
  // The transpiler reads a string where it is. Each `contents` here is a
  // substring: its JSString points into the characters of the string it was
  // cut from, and is the only reference to that string. The macro makes the
  // JSString take its own copy, so the collector frees the characters that the
  // transpiler reads, while the plugin still has `contents`. The transpiler
  // needs a reference of its own to the characters.
  const literals = Array.from({ length: 8 }, (_, i) => `a string literal that the printer reads back, number ${i}`);
  // Not more than 2048 characters: JSC copies a substring of that length when it becomes a property key.
  const body = [
    `import { atomize } from ${macros} with { type: "macro" };`,
    `export const during = atomize();`,
    `export const after = ${JSON.stringify(literals)};`,
  ].join("\n");
  const head = "// " + Buffer.alloc(4096, "x").toString() + "\n";
  const tail = "\n// " + Buffer.alloc(4096, "y").toString();

  const forms: [string, string, "import" | "require"][] = [
    ["onLoad import", "string:1", "import"],
    ["onLoad require", "string:2", "require"],
    ["async onLoad import", "async-string:3", "import"],
    ["build.module import", "string-module-4", "import"],
    ["build.module require", "string-module-5", "require"],
  ];

  // The substrings are cut in an earlier turn of the event loop. When onLoad
  // cuts them, the string they were cut from is still alive at the collection
  // in four of the five forms, and those forms then show nothing.
  const substrings: string[] = [];
  await new Promise<void>(resolve =>
    setImmediate(() => {
      for (let i = 0; i < forms.length; i++) {
        const cutFrom = [head, body, tail, i].join("");
        globalThis.cutFromLength = cutFrom.length;
        substrings.push(cutFrom.slice(head.length, head.length + body.length));
      }
      resolve();
    }),
  );
  await new Promise(resolve => setImmediate(resolve));

  const next = () => ({ contents: (globalThis.contents = substrings.pop()!), loader: "ts" });
  plugin({
    name: "string contents",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "string" }, ({ path }) => ({ path, namespace: "string" }));
      build.onResolve({ filter: /.*/, namespace: "async-string" }, ({ path }) => ({ path, namespace: "async-string" }));
      build.onLoad({ filter: /.*/, namespace: "string" }, next);
      build.onLoad({ filter: /.*/, namespace: "async-string" }, async () => {
        await 1;
        return next();
      });
      build.module("string-module-4", next);
      build.module("string-module-5", next);
    },
  });

  for (const [form, specifier, through] of forms) {
    try {
      const { during, after } = through === "import" ? await import(specifier) : require(specifier);
      results[form] = { during, intact: JSON.stringify(after) === JSON.stringify(literals) };
    } catch (e) {
      results[form] = failure(e);
    }
  }
}

if (Bun.isMainThread) {
  console.log(JSON.stringify(results));
  process.exit(0);
}
