// The program generator: writes runnable JS programs that exercise bun's
// runtime API from the extracted spec (driver/generated/api.gen.json). The
// seed IS the program: same seed -> byte-identical output, so a crashing
// program replays exactly and minimizes by statement.
//
// Design:
//  - Grammar from the spec (apispec.ts): Bun.* functions plus the methods
//    of the object KINDS those calls produce (BunFile, Subprocess, Server,
//    Socket, FileSink, ...). The return-type text links a call to the kind
//    it yields, so results feed an object POOL.
//  - Stateful sequences: each statement either creates a pooled object, calls
//    a method on a pooled one, or calls a plain function - so lifecycle and
//    ordering (use-after-close, double-close, concurrent unawaited calls,
//    kill mid-read) get exercised, not just isolated calls.
//  - Type-aware "interesting values" drawn per declared parameter type,
//    context-hinted by the parameter's NAME (path/url/cmd/data/...), so
//    calls get past argument validation into the implementation.
//  - Every statement is try/caught: an exception is data (validation vs
//    implementation), never a program abort. The program prints GEN-STATS
//    (ok/threw counts, kinds instantiated) and exits deterministically.
//
//   bun driver/gen.ts --seed S [--statements 40] [--out program.js]
//                     [--spec driver/generated/api.gen.json]

import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const here = import.meta.dir;
const seedArg = +(flag("--seed", "1") as string) >>> 0;
const nStatements = Math.max(4, +(flag("--statements", "40") as string));
const specPath = resolve(flag("--spec", join(here, "generated", "api.gen.json")) as string);
const outPath = flag("--out");

// --- PRNG (xorshift32, seeded) ----------------------------------------------
let seed = seedArg || 88172645;
const rnd = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >> 17;
  seed >>>= 0;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

// --- spec -----------------------------------------------------------------------
interface Param {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
}
interface Callable {
  path: string;
  container: string;
  name: string;
  params: Param[];
  returns: string;
  isMethod: boolean;
}
const spec: { callables: Callable[] } = await Bun.file(specPath).json();

// Scope: the runtime families. Service-bound clients (need external
// redis/sql/s3 servers), the test-runner surface (expect/mocks/describe -
// not runtime behavior), and interactive/host-specific surfaces are
// excluded by CATEGORY, never by hand-listing individual APIs.
// Excluded object families - by CATEGORY only:
//  - service-bound clients that need an external server (redis/sql/s3),
//  - the test-runner surface (expect/matchers/mocks/describe): not runtime,
//  - host/interactive surfaces (webview/terminal/plugin builder).
// Everything else with a live producer is drawable - Server, Socket,
// Subprocess, workers, sinks, streams: the runtime.
const EXCLUDE_CONTAINER =
  /^(RedisClient|SQL|TransactionSQL|ReservedSQL|Query|S3Client|S3File|Database|Statement|MatchersBuiltin|AsymmetricMatchersBuiltin\w*|MockInstance|Expect|Test|Describe|WebView|Terminal|Library|JSCallback|BunPlugin|BunRegisterPlugin|PluginBuilder|FileSystemRouter|CronJob|Image)$/;
// Bun.* functions we never generate: process/editor/build-tooling side
// effects with no runtime coverage value, or ones needing services.
const EXCLUDE_FN =
  /^(openInEditor|generateHeapSnapshot|build|plugin|serve|connect|listen|udpSocket|gc|shrink|sql|SQL|redis|RedisClient|s3|S3Client|dns|main|argv|env|version|revision|enableANSIColors|resolve|resolveSync|nanoseconds|jest|test|expect|mock|Cookie|CookieMap|password|zstdCompress|zstdDecompress|WebView|randomUUIDv5|secrets)$/;
// KNOWN-BROKEN (temporary, reversible when fixed upstream): APIs whose
// crashes are already reported. Every draw is a landmine that costs a full
// reduction and masks whatever lies behind it. Bun.write on Windows:
// (1) self-alias Bun.write(f,f) CopyFileWindows aliasing; (2) any missing/
// unopenable source -> on_copy_file ENOENT retry loop. Both reported.
const WRITE_MODE = process.env.WSF_GEN_MODE === "write";
// serve mode: one server, many hostile concurrent clients, stop mid-traffic.
const SERVE_MODE = process.env.WSF_GEN_MODE === "serve";
const KNOWN_BROKEN_FN = process.env.WSF_ALLOW_BROKEN || WRITE_MODE ? /^$/ : /^(write)$/;
// node module callables ("node:fs" containers): fs.readFileSync(...),
// child_process.spawn(...). Names that block the process (readline
// prompts, tty raw mode) or reach the network are excluded by name.
// crypto.createDiffieHellman/generatePrime: legitimately CPU-bound for large
// primes (a lead under investigation, not fuzzer noise) - excluded so one
// finding doesn't saturate the hang queue.
const EXCLUDE_NODE_FN = /^(crypto\.(createDiffieHellman|createDiffieHellmanGroup|generatePrime|generatePrimeSync|generateKeyPair|generateKeyPairSync|pbkdf2|pbkdf2Sync|scrypt|scryptSync)|fs\.(watch|watchFile|unwatchFile|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|truncate|truncateSync|chmod|chmodSync|chown|chownSync|utimes|utimesSync|lchown|lchmod|link|linkSync|symlink|symlinkSync|copyFile|copyFileSync|cp|cpSync|mkdtemp|mkdtempSync|writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)|child_process\.(exec|execFile|execSync|execFileSync)|.*\.(createInterface|clearScreenDown)|tty\..*|dns\.(lookup|resolve.*|reverse)|net\.(connect|createConnection)|http.*\.(get|request)|worker_threads\..*|os\.setPriority)$/;
const nodeFns = spec.callables.filter(c => /^node:/.test(c.container) && !EXCLUDE_NODE_FN.test(c.path));
const NODE_MODS = [...new Set(nodeFns.map(c => c.container.replace(/^node:/, "")))];
// WSF_GEN_MODE=fs concentrates the draw on filesystem/process surfaces -
// the libuv completion layer where the confirmed Windows crashes live.
const FS_MODE = process.env.WSF_GEN_MODE === "fs";
// WSF_GEN_MODE=depth: each program hammers ONE family (all callables that
// share a container/name-prefix) - the shape that found both confirmed
// crashes (many Bun.write variations per program), generalized.
const DEPTH_MODE = process.env.WSF_GEN_MODE === "depth";
const FS_KEEP = /^(node:fs|node:child_process|node:zlib|node:stream)$|^Bun$/;
const FS_BUN_FN = /^(file|write|spawn|spawnSync|mmap|openInEditor|resolveSync|resolve|pathToFileURL|fileURLToPath|which|readableStreamTo\w*|inspect|deflateSync|gzipSync|inflateSync|gunzipSync|zstdCompressSync|zstdDecompressSync|indexOfLine|stringWidth|escapeHTML|hash|allocUnsafe)$/;
const fnCalls = [
  ...spec.callables.filter(c => c.container === "Bun" && !EXCLUDE_FN.test(c.name) && !KNOWN_BROKEN_FN.test(c.name) && (!FS_MODE || FS_BUN_FN.test(c.name)) && (!WRITE_MODE || /^(write|file)$/.test(c.name))),
  ...nodeFns.filter(c => (!FS_MODE || FS_KEEP.test(c.container)) && !WRITE_MODE),
];
let emitComment = "";
if (process.argv.includes("--list-families")) {
  const fam = new Map<string, number>();
  for (const c of fnCalls) { const f = c.container === "Bun" ? "Bun." + c.name.replace(/(Sync|Async)$/, "") : c.container; fam.set(f, (fam.get(f) ?? 0) + 1); }
  for (const [f, n] of [...fam].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])) console.log(`${n}\t${f}`);
  process.exit(0);
}
// Depth mode: restrict the whole program to a single family chosen by seed.
if (DEPTH_MODE && fnCalls.length) {
  const families = new Map<string, typeof fnCalls>();
  for (const c of fnCalls) {
    const fam = c.container === "Bun" ? "Bun." + c.name.replace(/(Sync|Async)$/, "") : c.container;
    const arr = families.get(fam) ?? [];
    arr.push(c);
    families.set(fam, arr);
  }
  const usable = [...families.entries()].filter(([, v]) => v.length >= 2);
  if (usable.length) {
    const wanted = process.env.WSF_GEN_FAMILY;
    const chosen = (wanted && usable.find(([n]) => n === wanted)) || usable[Math.abs(Number(seedArg) * 2654435761 >>> 0) % usable.length];
    const [famName, famCalls] = chosen;
    fnCalls.length = 0;
    fnCalls.push(...famCalls);
    emitComment = `depth-family: ${famName} (${famCalls.length} callables)`;
  }
}
const methodsByKind = new Map<string, Callable[]>();
for (const c of spec.callables) {
  if (!c.isMethod || EXCLUDE_CONTAINER.test(c.container)) continue;
  const l = methodsByKind.get(c.container) ?? [];
  l.push(c);
  methodsByKind.set(c.container, l);
}
// Which Bun.* call PRODUCES a poolable kind (normalize the return text).
const kindOf = (returns: string): string | null => {
  let t = returns.replace(/\s+/g, " ").trim();
  t = t.replace(/^Promise<(.+)>$/, "$1").trim();
  t = t.split("|")[0].trim();
  t = t.replace(/<.*>$/, "").trim();
  return methodsByKind.has(t) ? t : null;
};
const producers = fnCalls.filter(c => kindOf(c.returns));
// Constructed kinds no Bun.* call "returns" but which anchor whole method
// families (Blob/Response/Request/streams) and derived objects (a FileSink
// from BunFile.writer()). Each entry: kind -> a JS expression producing one.
const BUILTIN_PRODUCERS: Record<string, string[]> = {
  Blob: [`new Blob(["blob text ".repeat(50)])`, `new Blob([BIG])`, `new Blob([])`, `Bun.file(P("data.txt"))`],
  Response: [`new Response("body text")`, `new Response(BIG)`, `new Response(null, { status: 204 })`, `new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8)); c.close(); } }))`, `Response.json({ a: [1, 2] })`, `Response.error()`],
  Request: [`new Request("http://" + HOST + "/echo")`, `new Request("http://" + HOST + "/echo", { method: "POST", body: "payload" })`, `new Request("http://" + HOST + "/big")`],
  ReadableStream: [`new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("chunk")); c.close(); } })`, `Bun.file(P("data.txt")).stream()`, `new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(4096)); if (Math.random() < 0.25) c.close(); } })`],
  FileSink: [`Bun.file(P("sink-" + $i() + ".txt")).writer()`, `Bun.file(P("out-sink.txt")).writer({ highWaterMark: 16 })`],
  CryptoHasher: [`new Bun.CryptoHasher("sha256")`, `new Bun.CryptoHasher("md5")`, `new Bun.CryptoHasher("blake2b512")`],
  Glob: [`new Bun.Glob("**/*.txt")`, `new Bun.Glob("*")`, `new Bun.Glob("no-match-**")`],
  Transpiler: [`new Bun.Transpiler({ loader: "ts" })`, `new Bun.Transpiler({ loader: "jsx" })`],
  ArrayBufferSink: [`new Bun.ArrayBufferSink()`],
  Archive: [],
  // bun:sqlite - historically use-after-close / finalize crashes
  Database: [
    `(() => { const { Database } = require("bun:sqlite"); return new Database(":memory:"); })()`,
    `(() => { const { Database } = require("bun:sqlite"); const d = new Database(P("db-" + $i() + ".sqlite")); d.run("CREATE TABLE t (a INTEGER, b TEXT)"); return d; })()`,
  ],
  Statement: [
    `(() => { const d = $pool("Database"); if (!d) throw new Error("pool-empty"); try { d.run("CREATE TABLE IF NOT EXISTS t (a INTEGER, b TEXT)"); } catch {} return d.query("SELECT * FROM t WHERE a = ?"); })()`,
    `(() => { const d = $pool("Database"); if (!d) throw new Error("pool-empty"); return d.prepare("INSERT INTO t (a, b) VALUES ($a, $b)"); })()`,
  ],
  // Worker - termination races are a top crash source
  Worker: [
    `new Worker(new URL("data:text/javascript,setInterval(()=>{},1); postMessage('up'); onmessage = e => postMessage(e.data)"), { name: "w" + $i() })`,
    `new Worker(new URL("data:text/javascript,while(false){} postMessage(1)"))`,
    `new Worker(new URL("data:text/javascript,throw new Error('boom-in-worker')"))`,
  ],
  Script: [
    `(() => { const vm = require("node:vm"); return new vm.Script("globalThis.x = (globalThis.x||0)+1; ({a:1})"); })()`,
  ],
  Context: [
    `(() => { const vm = require("node:vm"); return vm.createContext({ sandbox: 1 }); })()`,
  ],
  // Network kinds against targets we OWN: a second in-process server and a
  // TCP listener; sockets connect only to them (never the outside world).
  Server: [
    `Bun.serve({ port: 0, fetch: () => new Response("mini") })`,
    `Bun.serve({ port: 0, development: false, fetch(req, srv) { srv.timeout(req, 1); return new Response(BIG); } })`,
  ],
  Socket: [
    `Bun.connect({ hostname: "127.0.0.1", port: $srv ? $srv.port : 9, socket: { data() {}, open(s) { s.write("hi"); }, error() {}, close() {}, connectError() {} } })`,
  ],
  ShellPromise: [
    `Bun.$\`echo shell-out\``,
    `Bun.$\`echo one | ${"$"}{process.execPath} -e "process.stdin.pipe(process.stdout)"\``,
    `Bun.$\`exit 7\`.nothrow()`,
    `Bun.$\`cat < ${"$"}{Bun.file(P("data.txt"))}\`.quiet()`,
  ],
};
for (const k of Object.keys(BUILTIN_PRODUCERS)) if (!BUILTIN_PRODUCERS[k].length) delete BUILTIN_PRODUCERS[k];
// Kinds with a LIVE creator (a producer function or a built-in expression)
// and at least one method to call: the only kinds we draw methods on.

// Operations on kinds outside the .d.ts spec: lifecycle-heavy sequences
// (use-after-close, double-finalize, terminate mid-work) where bindings
// historically crash. `o` is the pooled receiver.
const EXTRA_OPS: Record<string, string[]> = {
  Database: [
    'o.run("INSERT INTO t (a, b) VALUES (?, ?)", [1, "x"])',
    'o.query("SELECT * FROM t").all()',
    'o.exec("PRAGMA integrity_check")',
    "o.serialize()",
    "o.close()",
    "o.close(true)",
    'o.transaction(() => { o.run("INSERT INTO t (a) VALUES (1)"); o.close(); })()',
    'o.query("SELECT ?").get(new Proxy({}, { get() { o.close(); return 1; } }))',
  ],
  Statement: [
    "o.all()",
    "o.get(1)",
    'o.run(1, "b")',
    "o.finalize()",
    "[...o.iterate(1)]",
    "o.values(1)",
    "o.toString()",
    "(o.finalize(), o.get(1))",
    'o.all({ toString() { o.finalize(); return "a"; } })',
  ],
  Worker: [
    "o.terminate()",
    "o.postMessage({ hostile: new Uint8Array(1e6) })",
    "o.postMessage(new SharedArrayBuffer(64))",
    '(o.postMessage("x"), o.terminate(), o.postMessage("y"))',
    "o.ref()",
    "o.unref()",
    'new Promise(r => { o.onmessage = () => { o.terminate(); r(1); }' + '; o.postMessage("go"); setTimeout(() => r(0), 500); })',
  ],
  Script: [
    "o.runInThisContext({ timeout: 5 })",
    "o.runInNewContext({ o }, { timeout: 5 })",
    'o.runInContext($pool("Context") ?? require("node:vm").createContext({}), { timeout: 5, breakOnSigint: true })',
    "o.createCachedData()",
  ],
  Context: [
    'require("node:vm").runInContext("x = 1; (() => x)()", o, { timeout: 5 })',
    'require("node:vm").runInContext("this", o)',
  ],
};

const producibleKinds = new Set<string>([
  ...producers.map(p => kindOf(p.returns)!),
  ...Object.keys(BUILTIN_PRODUCERS),
]);
const usableKinds = [...producibleKinds].filter(k => (methodsByKind.has(k) || EXTRA_OPS[k]) && !EXCLUDE_CONTAINER.test(k));

// --- value generation -------------------------------------------------------
// Emitted programs reference these helper bindings (defined in the preamble).
const V = {
  path: () =>
    pick([
      `P("data.txt")`, // exists, small text
      `P("big.bin")`, // exists, 256KB binary
      `P("empty.txt")`, // exists, zero bytes
      `P("no/such/dir/file.txt")`, // missing dir
      `P("missing.txt")`, // missing file
      `P(".")`, // a directory
      `P("data.txt/x")`, // path THROUGH a file
      `DIR`, // the scratch dir itself
      `P("uni-ë-🐰.txt")`, // unicode name (exists)
      `P("out-" + $i() + ".txt")`, // fresh writable target
      `P("../escape.txt")`, // relative escape
      `P("a".repeat(300))`, // over-long component
      // Windows-hostile paths: reserved device names, alternate data
      // streams, trailing dots/spaces (stripped by Win32), drive-relative,
      // extended-length and device namespaces, forward/back mixes, and a
      // lone surrogate in a filename (WTF-16, invalid UTF-16).
      `"NUL"`,
      // (CON/COM1/AUX removed: reading interactive/serial devices blocks by
      //  design and leaves unkillable processes - a false hang class)
      `P("stream.txt:ads:$DATA")`,
      `P("trailingdot.")`,
      `P("trailingspace ")`,
      `"C:relative-to-cwd.txt"`,
      `P("surro-\\ud800-gate.txt")`,
      `P("a".repeat(255)) + "/" + "b".repeat(200)`,
      `"\\\\\\\\?\\\\C:\\\\Windows"`,
      `"\\\\\\\\.\\\\PhysicalDrive0"`,
      `"\\\\\\\\localhost\\\\c\$\\\\Windows"`,
      `"//./nul"`,
    ]),
  string: () =>
    pick([
      `"file\\u0000nul.txt"`,
      `"\\ud83d"`, // unpaired high surrogate
      `"\\uffff\\ufffe"`, // noncharacters
      `""`,
      `"x"`,
      `"hello world"`,
      `"a".repeat(70000)`,
      `"line1\\nline2\\r\\nline3"`,
      `"with\\u0000nul"`,
      `"ünïcödé 🐰\\u{1F600}"`,
      `"\\ud800"`, // lone surrogate
      `JSON.stringify({ a: [1, 2, 3] })`,
      `"utf8"`,
      `"0"`,
    ]),
  number: () =>
    pick([`0`, `-1`, `1`, `2`, `4096`, `65536`, `2**31 - 1`, `2**31`, `2**32`, `2**53`, `-(2**31)`, `NaN`, `Infinity`, `-Infinity`, `1.5`, `0.1`, `Number.MAX_SAFE_INTEGER`]),
  boolean: () => pick([`true`, `false`]),
  bytes: () =>
    pick([
      `new Uint8Array(0)`,
      `new Uint8Array(1)`,
      `new Uint8Array(65536)`,
      `Buffer.from("chunk of buffer data 0123456789")`,
      `new Uint8Array([0, 255, 128, 7])`,
      `BIG`, // shared 256KB buffer
      `new Float64Array(8)`,
      `new DataView(new ArrayBuffer(16))`,
      `new SharedArrayBuffer(64)`,
      `(() => { const a = new ArrayBuffer(8); return a; })()`,
      `Buffer.alloc(0)`,
    ]),
  fn: () => pick([`() => {}`, `() => 42`, `(...a) => a`, `() => { throw new Error("cb boom"); }`, `async () => "ok"`, `function () { return this; }`]),
  url: () => pick([`"http://" + HOST + "/echo"`, `"http://" + HOST + "/slow"`, `"http://127.0.0.1:9/refused"`, `"file:///" + P("data.txt").replace(/\\\\/g, "/")`, `"data:text/plain,hi"`, `"http://" + HOST + "/big"`, `"blob:nodedata:invalid"`]),
  blob: () => pick([`new Blob(["blob text"])`, `new Blob([BIG])`, `Bun.file(P("data.txt"))`, `new Blob([])`, `new File(["f"], "n.txt")`]),
  stream: () =>
    pick([
      `new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("s")); c.close(); } })`,
      `new ReadableStream({ start(c) { c.error(new Error("stream boom")); } })`,
      `new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); if (Math.random() < 0.3) c.close(); } })`,
      `Bun.file(P("data.txt")).stream()`,
      `new ReadableStream()`,
    ]),
  object: () => pick([`{}`, `{ a: 1 }`, `Object.create(null)`, `new Proxy({}, { get() { throw new Error("proxy get"); } })`, `{ get x() { throw new Error("getter"); } }`, `[]`, `[1, "two", { three: 3 }]`, `null`, `undefined`, V.reentrant()]),
  // RE-ENTRANCY / side-effecting coercion - the dominant JS-binding bug
  // class: a value whose toString/valueOf/getter/Symbol.toPrimitive runs
  // during the API call and reaches back into the object pool (closing
  // the receiver, draining a stream, killing a child, mutating a buffer),
  // so native code observes state changing underneath it.
  reentrant: () => {
    const effect = pick([
      `try { $any("Socket")?.end(); } catch {}`,
      `try { $any("Server")?.stop(true); } catch {}`,
      `try { $any("Subprocess")?.kill(); } catch {}`,
      `try { $any("FileSink")?.end(); } catch {}`,
      `try { $any("ArrayBufferSink")?.end(); } catch {}`,
      `try { $any("ReadableStream")?.cancel(); } catch {}`,
      `try { $any("Blob")?.stream?.().cancel(); } catch {}`,
      `try { globalThis.gc?.(); } catch {}`,
      `try { $poolMutate(); } catch {}`,
    ]);
    return pick([
      `{ toString() { ${effect}; return "reentrant"; } }`,
      `{ valueOf() { ${effect}; return 7; } }`,
      `{ [Symbol.toPrimitive]() { ${effect}; return "p"; } }`,
      `{ get length() { ${effect}; return 4; }, get 0() { ${effect}; return 1; } }`,
      `new Proxy([1, 2, 3], { get(t, k) { ${effect}; return Reflect.get(t, k); } })`,
      `(() => { ${effect}; return 42; })`,
    ]);
  },
  // Detached / resizable / concurrently-transferred buffers.
  hostileBuffer: () =>
    pick([
      `(() => { const ab = new ArrayBuffer(64); try { structuredClone(ab, { transfer: [ab] }); } catch {} return new Uint8Array(ab); })()`,
      `new Uint8Array(new ArrayBuffer(8, { maxByteLength: 4096 }))`,
      `(() => { const ab = new ArrayBuffer(16, { maxByteLength: 64 }); const u = new Uint8Array(ab); try { ab.resize(0); } catch {} return u; })()`,
      `new Uint8Array(new SharedArrayBuffer(1024))`,
      `Buffer.allocUnsafe(0).subarray(0, 0)`,
    ]),
  any: () =>
    pick([V.reentrant(), V.hostileBuffer(), V.string(), V.number(), V.bytes(), V.object(), V.boolean(), `undefined`, `null`, `Symbol("s")`, `10n`, V.fn(), V.path()]),
};

// Enumerable string-literal unions ("a" | "b" | "c") from the type text.
const literalUnion = (t: string): string[] | null => {
  const parts = t.split("|").map(s => s.trim());
  if (parts.length < 2) return null;
  const lits = parts.filter(p => /^"[^"]*"$/.test(p));
  return lits.length >= 2 && lits.length === parts.filter(p => !/^(undefined|null)$/.test(p)).length ? lits : null;
};

// Object-type text "{ a?: string; b: number; ... }" -> a generated
// partial object with a random subset of members (best-effort parse).
function objectFromShape(t: string, depth: number): string | null {
  const m = /^\{([\s\S]*)\}$/.exec(t.trim());
  if (!m) return null;
  const body = m[1];
  // split top-level members on ';' (no nested-brace awareness beyond one level)
  const members: { name: string; opt: boolean; type: string }[] = [];
  let d = 0,
    cur = "";
  for (const ch of body) {
    if (ch === "{" || ch === "(" || ch === "<") d++;
    if (ch === "}" || ch === ")" || ch === ">") d--;
    if (ch === ";" && d === 0) {
      cur.trim() && push(cur);
      cur = "";
    } else cur += ch;
  }
  cur.trim() && push(cur);
  function push(seg: string) {
    const mm = /^\s*(?:readonly\s+)?["']?([A-Za-z_$][\w$]*)["']?(\?)?\s*:\s*([\s\S]+)$/.exec(seg.replace(/\/\*[\s\S]*?\*\//g, "").trim());
    if (mm) members.push({ name: mm[1], opt: !!mm[2], type: mm[3].trim() });
  }
  if (!members.length) return `{}`;
  const chosen = members.filter(mem => (mem.opt ? chance(0.5) : true));
  return `{ ${chosen.map(mem => `${JSON.stringify(mem.name)}: ${valueFor(mem.type, mem.name, depth + 1)}`).join(", ")} }`;
}

// Argument list for a callable: required parameters are always supplied;
// optional ones are included ~half the time (never leaving a required
// stream/array/cmd argument undefined - that only exercises validation).
function argList(c: Callable): string {
  const args = c.params.filter(p => !p.optional || chance(0.5)).map(p => valueFor(p.type, p.name));
  // (source steering below runs before the self-alias rewrite so it sees
  // the raw $pool draw)
  // Known-reported: any Bun.write whose SOURCE file does not exist (or is
  // unopenable: trailing-space/dot names, path-through-a-file, invalid
  // UTF-16) segfaults on Windows via the on_copy_file ENOENT retry loop.
  // Draw the source only from files the preamble actually CREATED so the
  // engine explores past the reported family; hostile paths still reach
  // every other API.
  // Any BunFile source - inline OR pooled (a pooled BunFile may name a
  // hostile/missing/ADS path built earlier in the program) - is redrawn
  // from files the preamble created; the missing-source family is reported.
  // ...and never a reserved device / non-file source (COM1, AUX, PhysicalDrive,
  // UNC, ADS, relative-drive): every unopenable-source shape lands in the same
  // reported uv_fs_copyfile ENOENT/retry site.
  if (!WRITE_MODE && c.path === "Bun.write" && args.length >= 2 && (/Bun\.file\(|\$pool2?\("BunFile"\)/.test(args[1]) || /"COM1"|"AUX"|"NUL"|"CON"|PhysicalDrive|ads:|localhost|relative-to-cwd/.test(args[1]))) {
    args[1] = pick([`Bun.file(P("data.txt"))`, `Bun.file(P("big.bin"))`, `Bun.file(P("empty.txt"))`]);
  }
  // Known-reported: Bun.write(x, x) with one pooled object as both
  // destination and source (aliased self-copy). Break the alias so the
  // engine explores past it instead of re-finding it in every program.
  if (!WRITE_MODE && c.path === "Bun.write" && args.length >= 2 && args[0] === args[1] && /\$pool\(/.test(args[0])) {
    args[1] = args[1].replace(/\$pool\((\"[A-Za-z]+\")\)/, "$pool2($1)");
  }
  return args.join(", ");
}

// A value expression for a parameter of declared type `t` named `name`.
function valueFor(tRaw: string, name: string, depth = 0): string {
  const t = tRaw.replace(/\s+/g, " ").trim();
  const n = name.toLowerCase();
  if (depth > 3) return `undefined`;
  // HARNESS SAFETY: a process id / signal target must never be an arbitrary
  // integer - a fuzzed process.kill(n) or kill(pid) can hit the driver or
  // its task wrapper. Only the program's OWN spawned children are targets.
  if (/^(pid|processid)$/.test(n)) return `($pool("Subprocess")?.pid ?? -1)`;
  // pooled object of a kind we know about
  const k = t.replace(/^Promise<(.+)>$/, "$1").split("|")[0].trim().replace(/<.*>$/, "");
  if (methodsByKind.has(k) && !EXCLUDE_CONTAINER.test(k)) return `$pool(${JSON.stringify(k)})`;
  const lits = literalUnion(t);
  if (lits) return chance(0.8) ? pick(lits) : `"not-a-valid-option"`;
  if (/^"[^"]*"$/.test(t)) return t;
  // by NAME hints first (paths, urls, commands, data)
  if (/path|file(?!s)|dir|cwd|dest|src|target|specifier/.test(n) && !/callback/.test(n)) return chance(0.85) ? V.path() : V.any();
  if (/^(url|href|origin)$/.test(n) || /\burl\b/i.test(t)) return V.url();
  if (/cmd|command|argv|arg[sv]/.test(n)) return chance(0.8) ? `SPAWN` : pick([`[process.execPath, "--version"]`, `["definitely-not-a-real-binary-xyz"]`, `[process.execPath, "-e", "process.exit(3)"]`, `[]`]);
  if (/encoding/.test(n)) return pick([`"utf8"`, `"utf16le"`, `"latin1"`, `"base64"`, `"hex"`, `"buffer"`, `"bad-enc"`]);
  // Duration parameters: an API whose contract is "wait this long" waits
  // this long - a huge value is a hang BY CONSTRUCTION, never a finding.
  // Draw only small/edge durations (0, negative, NaN, a few ms).
  if (/^(ms|millis|milliseconds|seconds|delay|duration|timeout|ttl|interval)$/.test(n) || /timeout|delay|duration/.test(n))
    return pick([`0`, `1`, `5`, `20`, `-1`, `0.5`, `NaN`]);
  if (/signal/.test(n)) return pick([`AbortSignal.timeout(50)`, `AbortSignal.abort()`, `new AbortController().signal`]);
  // by TYPE
  if (/^string$/.test(t)) return /data|input|content|body|text|source|code/.test(n) ? V.string() : chance(0.5) ? V.string() : `"str-" + $i()`;
  if (/^number$/.test(t) || /^(number \| undefined)$/.test(t)) return V.number();
  if (/^bigint$/.test(t)) return pick([`0n`, `1n`, `-1n`, `2n ** 64n`, `2n ** 63n - 1n`]);
  if (/^boolean$/.test(t)) return V.boolean();
  if (/PathLike|string \| URL/.test(t)) return V.path();
  if (/ReadableStream/.test(t) || /stream/.test(n)) return V.stream();
  if (/Blob|BunFile|Response|Request/.test(t) && /Blob/.test(t)) return V.blob();
  if (/ArrayBuffer|TypedArray|Uint8Array|Buffer|ArrayBufferView|BufferSource|BinaryLike|StringOrBuffer/.test(t)) return chance(0.7) ? V.bytes() : V.string();
  if (/^(URL)$/.test(t) || /string \| URL/.test(t)) return V.url();
  if (/=>|Function|\bCallback\b|Handler/.test(t)) return V.fn();
  if (/^Date$/.test(t)) return pick([`new Date()`, `new Date(0)`, `new Date(NaN)`, `new Date(8.64e15)`]);
  if (/Array<|(\[\])$/.test(t)) {
    const inner = /Array<(.+)>$/.exec(t)?.[1] ?? t.replace(/\[\]$/, "");
    const count = int(0, 4);
    return `[${Array.from({ length: count }, () => valueFor(inner, name, depth + 1)).join(", ")}]`;
  }
  const shape = objectFromShape(t, depth);
  if (shape) return shape;
  // spawn/exec option objects: the Windows-specific process code paths key
  // off stdio configs, windowsHide, windowsVerbatimArguments, detached,
  // shell and cwd - generate those shapes explicitly.
  if (/Spawn|SpawnOptions|ExecOptions|ForkOptions|CommonSpawnOptions/i.test(t) || (/options/.test(n) && /spawn|exec|fork/i.test(t)))
    return pick([
      `{ windowsHide: ${V.boolean()}, windowsVerbatimArguments: ${V.boolean()} }`,
      `{ stdio: [${pick(["\"pipe\"", "\"inherit\"", "\"ignore\"", "0", "\"ipc\""])}, ${pick(["\"pipe\"", "\"inherit\"", "\"ignore\"", "1"])}, ${pick(["\"pipe\"", "\"inherit\"", "\"ignore\"", "2", "\"ipc\""])}] }`,
      `{ detached: ${V.boolean()}, cwd: ${V.path()} }`,
      `{ shell: ${chance(0.5) ? V.boolean() : "\"cmd.exe\""}, windowsVerbatimArguments: ${V.boolean()} }`,
      `{ stdio: "${pick(["pipe", "inherit", "ignore", "overlapped"])}", cwd: ${V.path()}, env: ${chance(0.5) ? "{ ...process.env, WSF_X: \"1\" }" : "{}"} }`,
      `{ timeout: ${pick(["0", "1", "50", "-1", "2**31"])}, killSignal: ${pick(["\"SIGTERM\"", "\"SIGKILL\"", "9", "\"NOTASIGNAL\""])}, maxBuffer: ${pick(["0", "1", "1024", "-1"])} }`,
      `{}`,
    ]);
  if (/Options|Config|Init|Bag|Opts/.test(t)) return chance(0.5) ? `{}` : V.object();
  if (/unknown|any|\bT\b/.test(t)) return V.any();
  return V.any();
}



// --- program emission -----------------------------------------------------------
const L: string[] = [];
const emit = (s: string) => L.push(s);
let vid = 0;
const stats = { create: 0, method: 0, call: 0 };

// Preamble: scratch dir with real files, shared buffers, an echo child
// command using this very binary (portable spawn target), a local HTTP
// server for URL-valued arguments, the object pool, and the stats printer.
emit(`// GENERATED by winsysfuzz gen.ts - seed ${seedArg}, ${nStatements} statements`);
emit(`import { mkdirSync, writeFileSync, rmSync } from "node:fs";`);
emit(`import { join } from "node:path";`);
emit(`import { tmpdir } from "node:os";`);
// A UNIQUE scratch dir per run (pid): a re-run of the same seed must get
// a pristine tree, or run 1's leftover child processes and handles turn
// every replay into a different environment than the run that crashed.
emit(`const DIR = join(tmpdir(), "wsfgen-${seedArg}-" + process.pid);`);
emit(`rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });`);
emit(`const P = (s) => join(DIR, s);`);
emit(`const BIG = new Uint8Array(256 * 1024).map((_, i) => i % 251);`);
emit(`writeFileSync(P("data.txt"), "the quick brown fox jumps over the lazy dog\\n".repeat(20));`);
emit(`writeFileSync(P("big.bin"), BIG); writeFileSync(P("empty.txt"), ""); writeFileSync(P("uni-ë-🐰.txt"), "unicode name");`);
if (emitComment) emit(`// ${emitComment}`);
emit(`const SPAWN = [process.execPath, "-e", "process.stdin.pipe(process.stdout); setTimeout(()=>{}, 200)"];`);
// re-entrancy helpers: reach back into the pool from inside a coercion hook
emit(`function $any(kind) { const arr = $poolMap.get(kind); if (!arr || !arr.length) return undefined; return arr[(Math.random() * arr.length) | 0]; }`);
emit(`function $poolMutate() { for (const arr of $poolMap.values()) { if (arr.length && Math.random() < 0.5) arr.splice((Math.random() * arr.length) | 0, 1); } }`);
for (const m of NODE_MODS) emit(`const ${m} = require("node:${m}");`);
emit(`let $n = 0; const $i = () => ++$n;`);
emit(`const $stats = { ok: 0, threw: 0, kinds: new Set(), calls: 0 };`);
emit(`const $poolMap = new Map();`);
emit(`const $add = (kind, v) => { if (v == null) return v; const a = $poolMap.get(kind) ?? []; a.push(v); $poolMap.set(kind, a); $stats.kinds.add(kind); return v; };`);
emit(`const $pool = (kind) => { const a = $poolMap.get(kind); return a && a.length ? a[($n * 7919) % a.length] : undefined; };`);
emit(`const $pool2 = (kind) => { const a = $poolMap.get(kind); return a && a.length ? a[($n * 7919 + 1) % a.length] : undefined; };`);
// WSF_GEN_DEBUG=1: log every failing step's label + error - the input to
// generator iteration (validation rejections vs implementation errors).
emit(`const $dbg = !!process.env.WSF_GEN_DEBUG;`);
emit(`const $settle = (v) => (v && typeof v.then === "function") ? Promise.race([v.catch(() => undefined), new Promise(res => setTimeout(() => res(undefined), 700))]) : v;`);
emit(`process.on("unhandledRejection", e => { $stats.threw++; $stats.floating = ($stats.floating ?? 0) + 1; if ($dbg) console.error("FLOAT ", String(e).slice(0, 140)); });`);
emit(`process.on("uncaughtException", e => { $stats.threw++; $stats.floating = ($stats.floating ?? 0) + 1; if ($dbg) console.error("UNCAUGHT", String(e).slice(0, 140)); });`);
emit(`const $trace = !!process.env.WSF_GEN_TRACE;`);
emit(`async function $step(label, fn) { $stats.calls++; if ($trace) console.error("STEP  ", $stats.calls, label); try { const r = fn(); if (r && typeof r.then === "function") { r.catch(() => {}); const raced = await Promise.race([r.then(v => ({ s: "ok", v }), e => { if ($dbg) console.error("REJECT", label, String(e).slice(0, 140)); return { s: "threw" }; }), new Promise(res => setTimeout(() => res({ s: "pending" }), 700))]); if (raced.s === "threw") { $stats.threw++; return undefined; } $stats.ok++; return raced.s === "ok" ? raced.v : undefined; } $stats.ok++; return r; } catch (e) { $stats.threw++; if ($dbg) console.error("THROW ", label, String(e).slice(0, 140)); return undefined; } }`);
// A tiny local HTTP server so url-valued args have a live peer.
// Nothing in the preamble may abort the program: a failed serve leaves the
// URL-valued arguments pointing at a dead port (also a legit condition).
emit(`let $srv = null; try { $srv = Bun.serve({ port: 0, fetch(req) { const u = new URL(req.url); if (u.pathname === "/slow") return new Promise(res => setTimeout(() => res(new Response("slow")), 300)); if (u.pathname === "/big") return new Response(BIG); return new Response("echo:" + u.pathname); } }); } catch {}`);
emit(`const HOST = "127.0.0.1:" + ($srv ? $srv.port : 9);`);
emit(``);

// A statement: create / method / plain call.
const kindDrawn = new Map<string, number>();
const pickRareKind = (kinds: string[]): string => {
  // Weight each kind by 1/(1 + times drawn): under-exercised kinds win.
  const w = kinds.map(k => 1 / (1 + (kindDrawn.get(k) ?? 0)));
  let t = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kinds.length; i++) if ((t -= w[i]) <= 0) return note(kinds[i]);
  return note(kinds[kinds.length - 1]);
  function note(k: string) {
    kindDrawn.set(k, (kindDrawn.get(k) ?? 0) + 1);
    return k;
  }
};
function genCreate() {
  const useBuiltin = chance(0.5);
  if (useBuiltin || !producers.length) {
    const kind = pickRareKind(Object.keys(BUILTIN_PRODUCERS));
    const expr = pick(BUILTIN_PRODUCERS[kind]);
    emit(`const $v${++vid} = $add(${JSON.stringify(kind)}, await $settle($step(${JSON.stringify("new " + kind)}, () => ${expr})));`);
    stats.create++;
    return;
  }
  const c = pick(producers);
  const kind = kindOf(c.returns)!;
  const args = argList(c);
  const v = `$v${++vid}`;
  emit(`const ${v} = $add(${JSON.stringify(kind)}, await $settle($step(${JSON.stringify(c.path)}, () => ${c.path}(${args}))));`);
  stats.create++;
}
function genMethod() {
  if (!usableKinds.length) return genCall();
  const kind = pickRareKind(usableKinds);
  const await_ = chance(0.7) ? "await " : "";
  if (EXTRA_OPS[kind] && (!methodsByKind.has(kind) || chance(0.5))) {
    const op = pick(EXTRA_OPS[kind]);
    emit(`${await_}$step(${JSON.stringify(kind + ".extra")}, () => { const o = $pool(${JSON.stringify(kind)}); if (o == null) throw new Error("pool-empty"); return ${op}; });`);
    stats.method++;
    return;
  }
  const m = pick(methodsByKind.get(kind)!);
  emit(`${await_}$step(${JSON.stringify(m.path)}, () => { const o = $pool(${JSON.stringify(kind)}); if (o == null) throw new Error("pool-empty"); return o.${m.name}(${argList(m)}); });`);
  stats.method++;
}
// WRONG-THIS: invoke a native prototype method with a receiver of a
// different native kind (or a plain object). Bindings that trust `this`
// crash instantly - one of the fastest historical classes.
function genWrongThis() {
  const kindsWithProto = usableKinds.filter(k => methodsByKind.has(k));
  if (!kindsWithProto.length) return genMethod();
  const kind = pick(kindsWithProto);
  const m = pick(methodsByKind.get(kind)!);
  const recv = pick([
    ...usableKinds.filter(k => k !== kind).map(k => `$pool(${JSON.stringify(k)})`),
    `{}`,
    `[]`,
    `Object.create(null)`,
    `new Proxy({}, {})`,
    `1`,
    `"str"`,
    `null`,
    `globalThis`,
  ]);
  const ctor = `(globalThis[${JSON.stringify(kind)}] ?? Bun[${JSON.stringify(kind)}])`;
  emit(`await $step(${JSON.stringify("wrong-this " + m.path)}, () => { const f = ${ctor}?.prototype?.${m.name}; if (typeof f !== "function") throw new Error("no-method"); return f.call(${recv}, ${argList(m)}); });`);
  stats.method++;
}
// RECEIVER RE-ENTRANCY: a coercion hook on an argument closes/frees the
// very object being called, mid-call.
function genReenterReceiver() {
  const kindsWithProto = usableKinds.filter(k => methodsByKind.has(k));
  if (!kindsWithProto.length) return genMethod();
  const kind = pick(kindsWithProto);
  const withArgs = methodsByKind.get(kind)!.filter(m => m.params.length > 0);
  if (!withArgs.length) return genMethod();
  const m = pick(withArgs);
  const effect = `try { o.close?.(); o.end?.(); o.stop?.(true); o.kill?.(); o.cancel?.(); o.destroy?.(); o.finalize?.(); o.terminate?.(); o.abort?.(); } catch {}`;
  const hostile = pick([
    `{ toString() { ${effect} return "reenter"; } }`,
    `{ valueOf() { ${effect} return 3; } }`,
    `{ [Symbol.toPrimitive]() { ${effect} return "p"; } }`,
    `{ get length() { ${effect} return 8; }, get 0() { ${effect} return 1; } }`,
    `new Proxy([1, 2], { get(t, k) { ${effect} return Reflect.get(t, k); } })`,
  ]);
  const others = m.params.slice(1).map(p => valueFor(p.type, p.name));
  emit(`await $step(${JSON.stringify("reenter-recv " + m.path)}, () => { const o = $pool(${JSON.stringify(kind)}); if (o == null) throw new Error("pool-empty"); return o.${m.name}(${["("+hostile+")"].concat(others).join(", ")}); });`);
  stats.method++;
}
function genCall() {
  const c = pick(fnCalls);
  const args = c.params.filter(p => !p.optional || chance(0.55)).map(p => valueFor(p.type, p.name));
  const await_ = chance(0.6) ? "await " : "";
  emit(`${await_}$step(${JSON.stringify(c.path)}, () => ${c.path}(${args.join(", ")}));`);
  stats.call++;
}
// Lifecycle stress: revisit pooled objects with close/kill/etc, then reuse.
function genLifecycle() {
  if (!usableKinds.length) return genMethod();
  const kind = pick(usableKinds);
  if (!methodsByKind.has(kind)) return genMethod();
  const ms = methodsByKind.get(kind)!;
  const closers = ms.filter(m => /^(close|end|kill|stop|abort|destroy|flush|unref|ref|cancel|delete)$/.test(m.name));
  if (!closers.length) return genMethod();
  const m = pick(closers);
  emit(`await $step(${JSON.stringify(m.path + " (lifecycle)")}, () => { const o = $pool(${JSON.stringify(kind)}); if (o == null) throw new Error("pool-empty"); return o.${m.name}(); });`);
  // ...and immediately use the object again (use-after-close probe)
  const again = pick(ms);
  emit(`await $step(${JSON.stringify(again.path + " (after-close)")}, () => { const o = $pool(${JSON.stringify(kind)}); if (o == null) throw new Error("pool-empty"); return o.${again.name}(${argList(again)}); });`);
  stats.method += 2;
}

emit(`// --- generated statements --------------------------------------------------`);
// Seed the pool early: a burst of creations so methods have receivers.
for (let i = 0; i < Math.min(6, Math.max(3, Math.floor(nStatements / 8))); i++) genCreate();
if (SERVE_MODE) {
  // --- server-traffic scenario -----------------------------------------------
  const handlers = [
    `fetch(req) { return new Response("ok"); }`,
    `fetch(req) { return new Response(BIG, { headers: { "x-h": "v".repeat(2000) } }); }`,
    `fetch(req) { throw new Error("handler-throw"); }`,
    `async fetch(req) { await Bun.sleep(5); const b = await req.text().catch(() => ""); return new Response(b); }`,
    `fetch(req) { return new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65536)); if (Math.random() < 0.3) c.close(); } })); }`,
    `fetch(req, srv) { if (srv.upgrade(req)) return; return new Response("no-up", { status: 400 }); }`,
    `fetch(req) { return new Response(Bun.file(P("big.bin"))); }`,
    `async fetch(req) { for await (const _ of req.body ?? []) {} return new Response("drained"); }`,
    `fetch(req, srv) { srv.stop(); return new Response("stopped-self"); }`,
    `fetch(req) { return Response.redirect("http://" + req.headers.get("host") + "/loop", 302); }`,
  ];
  const wsHandlers = `websocket: { open(ws) { ws.send("x".repeat(1024)); if (${rnd() < 0.5}) ws.close(); }, message(ws, m) { try { ws.send(m); ws.publish?.("t", m); } catch {} if (${rnd() < 0.3}) ws.terminate?.(); }, close() {}, drain() {}, ping() {}, pong() {} },`;
  emit(`let $reqs = 0;`);
  emit(`const $S = Bun.serve({ port: 0, development: false, ${pick(handlers).replace("fetch(req", "fetch(req").replace(/fetch\(req(, srv)?\) \{/, m => m + " $reqs++;")}, ${wsHandlers} error(e) { return new Response("err", { status: 500 }); } });`);
  emit(`const CRLF = String.fromCharCode(13, 10);`);
  emit(`const $U = "http://127.0.0.1:" + $S.port + "/p";`);
  const nClients = int(6, 26);
  const clientKinds = [
    () => `fetch($U + "?q=" + ${vid}, { signal: AbortSignal.timeout(${int(0, 40)}) }).then(r => r.arrayBuffer()).catch(() => {})`,
    () => `(async () => { const ac = new AbortController(); const p = fetch($U, { method: "POST", body: BIG, signal: ac.signal }).catch(() => {}); ${rnd() < 0.7 ? `await Bun.sleep(${int(0, 15)}); ac.abort();` : ""} await p; })()`,
    () => `fetch($U, { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(4096))); ${rnd() < 0.5 ? "c.error(new Error(\"body-err\"));" : "c.close();"} } }), duplex: "half" }).then(r => r.text()).catch(() => {})`,
    () => `Bun.connect({ hostname: "127.0.0.1", port: $S.port, socket: { open(s) { s.write("GET / HTTP/1.1" + CRLF + "Host: x" + CRLF + ${rnd() < 0.5 ? '"Content-Length: 99999" + CRLF + ' : ""}CRLF + ${rnd() < 0.5 ? '"GARBAGE"' : '""'}); ${pick(["s.end();", "s.shutdown?.();", "s.destroy?.();", ""])} }, data(s) { ${rnd() < 0.5 ? "s.end();" : ""} }, close() {}, error() {} } }).catch(() => {})`,
    () => `(async () => { const ws = new WebSocket("ws://127.0.0.1:" + $S.port + "/ws"); ws.onopen = () => { try { ws.send("m".repeat(${int(1, 65536)})); } catch {} ${rnd() < 0.6 ? "ws.close();" : ""} }; ws.onerror = () => {}; await Bun.sleep(${int(5, 60)}); try { ws.terminate?.() ?? ws.close(); } catch {} })()`,
    () => `fetch($U, { headers: { "h": "v".repeat(${pick(["100", "8000", "64000"])}) } }).then(r => r.text()).catch(() => {})`,
  ];
  emit(`const $clients = [`);
  for (let i = 0; i < nClients; i++) emit(`  ${pick(clientKinds)()},`);
  emit(`];`);
  // stop / reload the server mid-traffic
  const midOps = [
    `Bun.sleep(${int(0, 30)}).then(() => { try { $S.stop(${rnd() < 0.5 ? "true" : ""}); } catch {} })`,
    `Bun.sleep(${int(0, 30)}).then(() => { try { $S.reload({ fetch() { return new Response("reloaded"); } }); } catch {} })`,
    `Bun.sleep(${int(0, 30)}).then(() => { try { $S.publish?.("t", "broadcast"); } catch {} })`,
    `Promise.resolve()`,
  ];
  emit(`$clients.push(${pick(midOps)});`);
  emit(`const $settled = await Promise.race([Promise.allSettled($clients), Bun.sleep(2500)]);`);
  emit(`console.log("SERVE-STATS " + JSON.stringify({ reqs: $reqs, clients: $clients.length, settled: Array.isArray($settled) ? $settled.length : "timeout" }));`);
  emit(`try { $S.stop(true); } catch {}`);
  emit(`await Bun.sleep(30);`);
}
for (let i = 0; i < (SERVE_MODE ? 0 : nStatements); i++) {
  const r = rnd();
  if (WRITE_MODE) {
    // Bun.write / Bun.file depth: every call, every source shape
    if (r < 0.75) genCall();
    else genCreate();
    continue;
  }
  if (DEPTH_MODE) {
    // hammer the chosen family: mostly plain calls with hostile args
    if (r < 0.7) genCall();
    else if (r < 0.85) genCreate();
    else genLifecycle();
    continue;
  }
  if (r < 0.18) genCreate();
  else if (r < 0.44) genMethod();
  else if (r < 0.56) genLifecycle();
  else if (r < 0.66) genCall();
  else if (r < 0.78) genWrongThis();
  else if (r < 0.9) genReenterReceiver();
  else {
    // concurrency: fire several unawaited method calls on one object at once
    const kind = pick(usableKinds.length ? usableKinds : ["Blob"]);
    const ms = methodsByKind.get(kind) ?? [];
    if (ms.length) {
      const picks = Array.from({ length: int(2, 4) }, () => pick(ms));
      emit(`await $step("concurrent:${kind}", () => { const o = $pool(${JSON.stringify(kind)}); if (o == null) throw new Error("pool-empty"); return Promise.allSettled([${picks.map(m => `Promise.resolve().then(() => o.${m.name}(${argList(m)}))`).join(", ")}]); });`);
      stats.method += picks.length;
    }
  }
  if (chance(0.08)) emit(`await Bun.sleep(0);`);
}

// Epilogue: settle, print stats, force a deterministic exit.
emit(``);
emit(`await Bun.sleep(20);`);
emit(`try { if ($srv) $srv.stop(true); } catch {}`);
emit(`const $line = "GEN-STATS " + JSON.stringify({ seed: ${seedArg}, calls: $stats.calls, ok: $stats.ok, threw: $stats.threw, floating: $stats.floating ?? 0, kinds: [...$stats.kinds] });`);
emit(`console.log($line);`);
emit(`if (process.env.WSF_GEN_STATS) { try { require("node:fs").appendFileSync(process.env.WSF_GEN_STATS, $line + "\\n"); } catch {} }`);
emit(`try { rmSync(DIR, { recursive: true, force: true }); } catch {}`);
emit(`process.exit(0);`);

const program = L.join("\n") + "\n";
// Correctness bar #1: every generated program parses. Check our own
// output with the transpiler and fail LOUDLY if a template broke syntax.
try {
  new Bun.Transpiler({ loader: "js" }).scan(program);
} catch (e) {
  console.error(`gen: GENERATED PROGRAM DOES NOT PARSE (seed ${seedArg}): ${String(e).slice(0, 200)}`);
  if (process.env.WSF_GEN_DEBUG) {
    // show the offending lines to fix the template, then bail
    const errs = (e && (e as any).errors) || [];
    for (const er of errs.slice(0, 3)) console.error("  ", String(er));
  }
  process.exit(3);
}
if (outPath) await Bun.write(outPath, program);
else process.stdout.write(program);
console.error(`gen: seed=${seedArg} statements=${nStatements} (create=${stats.create} method=${stats.method} call=${stats.call})`);
