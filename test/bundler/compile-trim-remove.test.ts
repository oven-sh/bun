import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows } from "harness";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { run } from "../aot/harness/run";
import { inTurn } from "../aot/harness/shared-builds";
import { copyWithoutDebugInformation } from "../aot/harness/without-debug-information";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import { canTrim, describeBytesRemovedWith, tempDirForAotBuilds, trimFeatureNamed } from "./compile-trim-features";

// `compile.trim.remove` takes a feature out of an executable whose program uses it. The names stay: an import works, `typeof` answers as
// before. A call throws an error with the code ERR_FEATURE_REMOVED that says how the executable was built.

const getpid = isWindows ? "GetCurrentProcessId" : "getpid";
const told = `(error: any) => console.log(error.code, String(error.message).includes("compile.trim.remove"))`;

// One program. `whole` is what the part prints where the feature is kept, `cut` where it is removed.
const parts: { remove: string; text: string; whole: string; cut: string }[] = [
  {
    remove: "ffi",
    text: `console.log("started");
const { dlopen, suffix } = await import("bun:ffi");
console.log(typeof dlopen, typeof suffix);
try { console.log(typeof dlopen(process.env.LIBC!, { ${getpid}: { returns: "int" } }).symbols.${getpid}()); } catch (error) { (${told})(error); }`,
    whole: "started\nfunction string\nnumber\n",
    cut: "started\nfunction string\nERR_FEATURE_REMOVED true\n",
  },
  {
    remove: "native-addons",
    text: `console.log(typeof process.dlopen);
try { process.dlopen({ exports: {} }, "./none.node"); } catch (error: any) { console.log(error.code === "ERR_FEATURE_REMOVED" ? "removed" : "tried", String(error.message).includes("compile.trim.remove")); }`,
    whole: "function\ntried false\n",
    cut: "function\nremoved true\n",
  },
  {
    remove: "sqlite",
    text: `import { Database } from "bun:sqlite";
console.log(typeof Database);
try { console.log(JSON.stringify(new Database(":memory:").query("select 1 as a").get())); } catch (error) { (${told})(error); }`,
    whole: 'function\n{"a":1}\n',
    cut: "function\nERR_FEATURE_REMOVED true\n",
  },
  {
    remove: "image",
    text: `console.log(typeof Bun.Image);
try { console.log(typeof new Bun.Image(new Uint8Array(8))); } catch (error) { (${told})(error); }`,
    whole: "function\nobject\n",
    cut: "function\nERR_FEATURE_REMOVED true\n",
  },
  {
    remove: "brotli",
    text: `import zlib from "node:zlib";
console.log(zlib.gunzipSync(zlib.gzipSync("abc")).toString(), zlib.zstdDecompressSync(zlib.zstdCompressSync("abc")).toString(), typeof zlib.brotliCompressSync, typeof zlib.createBrotliDecompress);
for (const use of [() => zlib.brotliDecompressSync(zlib.brotliCompressSync("abc")).toString(), () => zlib.brotliDecompressSync(Buffer.from("CwGAYWJjAw==", "base64")).toString(), () => typeof zlib.createBrotliCompress()]) {
  try { console.log(use()); } catch (error) { (${told})(error); }
}
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
    whole:
      "abc abc function function\nabc\nabc\nobject\n" +
      "gzip, deflate, br, zstd\nzipped\nabc\nCompressionStream\nDecompressionStream\nCompressionStream\n",
    cut:
      "abc abc function function\nERR_FEATURE_REMOVED true\nERR_FEATURE_REMOVED true\nERR_FEATURE_REMOVED true\n" +
      "gzip, deflate, zstd\nzipped\nrejected BrotliFailedToLoad\nERR_FEATURE_REMOVED true\nERR_FEATURE_REMOVED true\nCompressionStream\n",
  },
];

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

const libc = isWindows ? "kernel32.dll" : isLinux ? "libc.so.6" : "/usr/lib/libSystem.B.dylib";
const fileOf = (executable: string) => (isWindows ? executable + ".exe" : executable);

// What the link of this Bun wrote down about the features with `name` in their names: how large their groups are, and what of them other code keeps.
function readLinkReview(name: string): string {
  const folder = bunExe() + ".trim";
  if (!existsSync(folder)) return "";
  const isNamed = (text: string) => text.toLowerCase().includes(name.replaceAll("-", ""));
  const read = (file: string) => readFileSync(join(folder, file), "utf8");
  const kept = read("retained-by.txt")
    .split("\n\n")
    .filter(block => isNamed(block.slice(0, block.indexOf(":"))))
    .flatMap(block => block.split("\n").slice(0, 24));
  return [...read("groups.txt").split("\n").filter(isNamed), ...kept].map(line => line.slice(0, 240)).join("\n");
}

(canTrim && !unsupported ? describe.concurrent : describe.skip)("compile.trim.remove", () => {
  const dir = tempDirForAotBuilds("compile-trim-remove", {
    "build.mjs": `const [entry, outfile, trim, executablePath] = process.argv.slice(2);
try {
  const result = await Bun.build({
    entrypoints: [entry],
    compile: { outfile, aot: true, trim: JSON.parse(trim), ...(executablePath && { executablePath }) },
  });
  for (const { message } of result.logs) console.error(message.split(": ", 2).join(": "));
  console.log(result.success ? "built" : "failed");
} catch (error) {
  console.log(String(error.message));
}`,
    "hello.ts": `console.log("hello world");`,
    "uses-them.ts": parts.map(({ text }) => text).join("\n"),
    "imports-modules.ts": modulesWithNativeBindings
      .map(
        ([specifier, , call], index) => `import * as imported${index} from ${JSON.stringify(specifier)};
console.log(typeof imported${index});
try { ${call.replace("imported", "imported" + index) || "throw { code: 'ERR_FEATURE_REMOVED', message: 'compile.trim.remove' }"}; console.log("returned"); } catch (error) { (${told})(error); }`,
      )
      .join("\n"),
  });
  afterAll(() => dir[Symbol.dispose]());
  const folder = String(dir);

  const builds = new Map<string, Promise<{ executable: string; stdout: string; stderr: string; exitCode: number }>>();
  const build = (entry: string, trim: object) =>
    builds.getOrInsertComputed(JSON.stringify([entry, trim]), () => {
      const executable = join(folder, `built-${builds.size}`);
      const carrier = copyWithoutDebugInformation ? [copyWithoutDebugInformation] : [];
      return inTurn(async () => ({
        executable,
        ...(await run([bunExe(), "build.mjs", `./${entry}`, executable, JSON.stringify(trim), ...carrier], folder)),
      }));
    });
  const everyName = [...new Set(parts.map(({ remove }) => remove))];

  test.each([
    ["is kept", {}, "whole"],
    ["is removed", { remove: everyName }, "cut"],
  ] as const)("where each %s: the names stay, and a call says whether the feature is there", async (_, trim, which) => {
    const built = await build("uses-them.ts", trim);
    expect(built).toMatchObject({ stdout: "built\n", exitCode: 0 });
    expect(await run([built.executable], folder, { ...bunEnv, LIBC: libc })).toMatchObject({
      stdout: parts.map(part => part[which]).join(""),
      exitCode: 0,
    });
  });

  test.each(everyName)("the executable is smaller without %s", async name => {
    const kept = await build("hello.ts", { allow: [name], log: true });
    const withoutIt = await build("hello.ts", { log: true });
    expect([kept, withoutIt]).toMatchObject([
      { stdout: "built\n", exitCode: 0 },
      { stdout: "built\n", exitCode: 0 },
    ]);
    const saved = statSync(fileOf(kept.executable)).size - statSync(fileOf(withoutIt.executable)).size;
    if (saved <= smallest[name]! * 1024) {
      const removed = readRemovedFeatures(fileOf(withoutIt.executable)) ?? [];
      const bytes = trimFeatureNamed(name).features.map(feature => describeBytesRemovedWith(feature, removed));
      console.log(
        `with ${name}:\n${kept.stderr}without:\n${withoutIt.stderr}${bytes.join("\n")}\n${readLinkReview(name)}`,
      );
    }
    expect(saved).toBeGreaterThan(smallest[name]! * 1024);
  });

  test("importing a module works without the feature behind it, and a call throws", async () => {
    const built = await build("imports-modules.ts", {
      remove: [...new Set(modulesWithNativeBindings.map(([, remove]) => remove))],
    });
    expect(built).toMatchObject({ stdout: "built\n", exitCode: 0 });
    const { stdout, exitCode } = await run([built.executable], folder);
    const answers = stdout.split("\n");
    expect({
      exitCode,
      answers: modulesWithNativeBindings.map(
        ([specifier, , call], index) => `${specifier} ${call}: ${answers[2 * index]}, ${answers[2 * index + 1]}`,
      ),
    }).toEqual({
      exitCode: 0,
      answers: modulesWithNativeBindings.map(
        ([specifier, , call]) => `${specifier} ${call}: object, ERR_FEATURE_REMOVED true`,
      ),
    });
  });

  test("a name in both lists, and a name that Bun doesn't know, fail the build", async () => {
    expect((await build("hello.ts", { allow: ["image"], remove: ["image"] })).stdout).toBe(
      'compile.trim: "image" is listed in both allow and remove\n',
    );
    expect((await build("hello.ts", { remove: ["imag"] })).stdout).toBe(
      'compile.trim: unknown name "imag". Did you mean "image"?\n',
    );
  });
});
