import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/run-programs";
import { canTrim, tempDirForAotBuilds } from "./compile-trim-features";

// `compile.trim.remove` takes a feature out of an executable whose program uses it. The names stay: an import works, `typeof` answers as
// before. A call throws an error with the code ERR_FEATURE_REMOVED that says how the executable was built.

const getpid = isWindows ? "GetCurrentProcessId" : "getpid";
const told = `(error: any) => console.log(error.code, String(error.message).includes("compile.trim.remove"))`;

const programs: Record<string, { remove: string; text: string; whole: string; cut: string }> = {
  "ffi.ts": {
    remove: "ffi",
    text: `import { dlopen, suffix } from "bun:ffi";
console.log(typeof dlopen, typeof suffix);
try { console.log(typeof dlopen(process.env.LIBC!, { ${getpid}: { returns: "int" } }).symbols.${getpid}()); } catch (error) { (${told})(error); }`,
    whole: "function string\nnumber\n",
    cut: "function string\nERR_FEATURE_REMOVED true\n",
  },
  "ffi-imported-late.ts": {
    remove: "ffi",
    text: `console.log("started");
const ffi = await import("bun:ffi");
console.log(typeof ffi.dlopen);`,
    whole: "started\nfunction\n",
    cut: "started\nfunction\n",
  },
  "native-addons.ts": {
    remove: "native-addons",
    text: `console.log(typeof process.dlopen);
try { process.dlopen({ exports: {} }, "./none.node"); } catch (error: any) { console.log(error.code === "ERR_FEATURE_REMOVED" ? "removed" : "tried", String(error.message).includes("compile.trim.remove")); }`,
    whole: "function\ntried false\n",
    cut: "function\nremoved true\n",
  },
  "sqlite.ts": {
    remove: "sqlite",
    text: `import { Database } from "bun:sqlite";
console.log(typeof Database);
try { console.log(JSON.stringify(new Database(":memory:").query("select 1 as a").get())); } catch (error) { (${told})(error); }`,
    whole: 'function\n{"a":1}\n',
    cut: "function\nERR_FEATURE_REMOVED true\n",
  },
  "image.ts": {
    remove: "image",
    text: `console.log(typeof Bun.Image);
try { console.log(typeof new Bun.Image(new Uint8Array(8))); } catch (error) { (${told})(error); }`,
    whole: "function\nobject\n",
    cut: "function\nERR_FEATURE_REMOVED true\n",
  },
  "brotli-in-zlib.ts": {
    remove: "brotli",
    text: `import zlib from "node:zlib";
console.log(zlib.gunzipSync(zlib.gzipSync("abc")).toString(), zlib.zstdDecompressSync(zlib.zstdCompressSync("abc")).toString(), typeof zlib.brotliCompressSync, typeof zlib.createBrotliDecompress);
for (const use of [() => zlib.brotliDecompressSync(zlib.brotliCompressSync("abc")).toString(), () => zlib.brotliDecompressSync(Buffer.from("CwGAYWJjAw==", "base64")).toString(), () => typeof zlib.createBrotliCompress()]) {
  try { console.log(use()); } catch (error) { (${told})(error); }
}`,
    whole: "abc abc function function\nabc\nabc\nobject\n",
    cut: "abc abc function function\nERR_FEATURE_REMOVED true\nERR_FEATURE_REMOVED true\nERR_FEATURE_REMOVED true\n",
  },
  "brotli-in-fetch-and-streams.ts": {
    remove: "brotli",
    text: `import zlib from "node:zlib";
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/br") return new Response(Buffer.from("CwGAYWJjAw==", "base64"), { headers: { "content-encoding": "br" } });
    if (pathname === "/gzip") return new Response(zlib.gzipSync("zipped"), { headers: { "content-encoding": "gzip" } });
    return new Response(request.headers.get("accept-encoding"));
  },
});
console.log(await (await fetch(server.url)).text());
console.log(await (await fetch(new URL("/gzip", server.url))).text());
try { console.log(await (await fetch(new URL("/br", server.url))).text()); } catch (error: any) { console.log("rejected", error.code ?? error.name); }
for (const make of [() => new CompressionStream("brotli" as any), () => new DecompressionStream("brotli" as any), () => new CompressionStream("gzip")]) {
  try { console.log(make().constructor.name); } catch (error) { (${told})(error); }
}
server.stop(true);`,
    whole: "gzip, deflate, br, zstd\nzipped\nabc\nCompressionStream\nDecompressionStream\nCompressionStream\n",
    cut: "gzip, deflate, zstd\nzipped\nrejected BrotliFailedToLoad\nERR_FEATURE_REMOVED true\nERR_FEATURE_REMOVED true\nCompressionStream\n",
  },
};

const modulesWithNativeBindings: [specifier: string, remove: string, call: string][] = [
  ["bun:sqlite", "sqlite", `new imported.Database(":memory:")`],
  ["node:vm", "node-vm", `imported.runInNewContext("1")`],
  ["node:crypto", "node-crypto", `imported.createHash("sha256")`],
  ["node:worker_threads", "worker", `new imported.Worker("./none.js")`],
  ["node:dns", "dns", `new imported.Resolver()`],
  ["node:dns", "dns", `imported.lookup("localhost", () => {})`],
  ["node:dgram", "udp", ""],
  ["node:net", "sockets", `imported.connect(1)`],
  ["node:tls", "sockets", `imported.connect(1)`],
  ["node:test", "test", ""],
];

// What leaves the file with each at the least, in KB: the native library behind it, not only the functions that JavaScript calls.
const smallest: Record<string, number> = {
  "ffi": 256,
  "native-addons": 128,
  // On macOS Bun loads the system's SQLite, so only what calls it leaves.
  "sqlite": isMacOS ? 256 : 1024,
  "image": 512,
  "brotli": 256,
};

const buildScript = `const [entry, outfile, trim] = process.argv.slice(2);
try {
  const result = await Bun.build({ entrypoints: [entry], compile: { outfile, aot: true, trim: JSON.parse(trim) } });
  console.log(result.success ? "built" : "failed");
} catch (error) {
  console.log(String(error.message));
}`;

const libc = isWindows ? "kernel32.dll" : isLinux ? "libc.so.6" : "/usr/lib/libSystem.B.dylib";
const sizeOf = (executable: string) => statSync(isWindows ? executable + ".exe" : executable).size;

describe.skipIf(!canTrim || !!unsupported)("compile.trim.remove", () => {
  const files = {
    "build.mjs": buildScript,
    ...Object.fromEntries(Object.entries(programs).map(([name, { text }]) => [name, text])),
  };
  const build = (folder: string, entry: string, outfile: string, trim: object) =>
    spawned([bunExe(), "build.mjs", `./${entry}`, join(folder, outfile), JSON.stringify(trim)], folder, bunEnv);

  test.each(Object.keys(programs))(
    "%s: the names stay, a call says that the feature is not there, and the executable is smaller",
    async entry => {
      const { remove, whole, cut } = programs[entry]!;
      using dir = tempDirForAotBuilds("compile-trim-remove", files);
      const folder = String(dir);
      const env = { ...bunEnv, LIBC: libc };
      expect(await build(folder, entry, "kept", {})).toMatchObject({ stdout: "built\n", exitCode: 0 });
      expect(await build(folder, entry, "cut", { remove: [remove] })).toMatchObject({ stdout: "built\n", exitCode: 0 });
      expect(await spawned([join(folder, "kept")], folder, env)).toMatchObject({ stdout: whole, exitCode: 0 });
      expect(await spawned([join(folder, "cut")], folder, env)).toMatchObject({ stdout: cut, exitCode: 0 });
      expect(sizeOf(join(folder, "kept")) - sizeOf(join(folder, "cut"))).toBeGreaterThan(smallest[remove]! * 1024);
    },
    240_000,
  );

  test.each(modulesWithNativeBindings)(
    "importing %s works without %s, and %s throws",
    async (specifier, remove, call) => {
      using dir = tempDirForAotBuilds("compile-trim-remove", {
        "build.mjs": buildScript,
        "entry.ts": `import * as imported from ${JSON.stringify(specifier)};
console.log(typeof imported);
try { ${call || "throw { code: 'ERR_FEATURE_REMOVED', message: 'compile.trim.remove' }"}; console.log("returned"); } catch (error) { (${told})(error); }`,
      });
      const folder = String(dir);
      expect(await build(folder, "entry.ts", "cut", { remove: [remove] })).toMatchObject({
        stdout: "built\n",
        exitCode: 0,
      });
      expect(await spawned([join(folder, "cut")], folder, bunEnv)).toMatchObject({
        stdout: "object\nERR_FEATURE_REMOVED true\n",
        exitCode: 0,
      });
    },
    240_000,
  );

  test("a name in both lists, and a name that Bun doesn't know, fail the build", async () => {
    using dir = tempDirForAotBuilds("compile-trim-remove", files);
    const folder = String(dir);
    expect((await build(folder, "image.ts", "both", { allow: ["image"], remove: ["image"] })).stdout).toBe(
      'compile.trim: "image" is listed in both allow and remove\n',
    );
    expect((await build(folder, "image.ts", "unknown", { remove: ["imag"] })).stdout).toBe(
      'compile.trim: unknown name "imag". Did you mean "image"?\n',
    );
  }, 120_000);
});
