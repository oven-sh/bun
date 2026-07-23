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
const fnCalls = spec.callables.filter(c => c.container === "Bun" && !EXCLUDE_FN.test(c.name));
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
const producibleKinds = new Set<string>([
  ...producers.map(p => kindOf(p.returns)!),
  ...Object.keys(BUILTIN_PRODUCERS),
]);
const usableKinds = [...producibleKinds].filter(k => methodsByKind.has(k) && !EXCLUDE_CONTAINER.test(k));

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
      `"CON"`,
      `"NUL"`,
      `"COM1"`,
      `P("aux.txt")`,
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
      `"CON"`,
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
  object: () => pick([`{}`, `{ a: 1 }`, `Object.create(null)`, `new Proxy({}, { get() { throw new Error("proxy get"); } })`, `{ get x() { throw new Error("getter"); } }`, `[]`, `[1, "two", { three: 3 }]`, `null`, `undefined`]),
  any: () =>
    pick([V.string(), V.number(), V.bytes(), V.object(), V.boolean(), `undefined`, `null`, `Symbol("s")`, `10n`, V.fn(), V.path()]),
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
  // Known-reported: Bun.write(x, x) with one pooled object as both
  // destination and source (aliased self-copy). Break the alias so the
  // engine explores past it instead of re-finding it in every program.
  if (c.path === "Bun.write" && args.length >= 2 && args[0] === args[1] && /\$pool\(/.test(args[0])) {
    args[1] = args[1].replace(/\$pool\((\"[A-Za-z]+\")\)/, "$pool2($1)");
  }
  return args.join(", ");
}

// A value expression for a parameter of declared type `t` named `name`.
function valueFor(tRaw: string, name: string, depth = 0): string {
  const t = tRaw.replace(/\s+/g, " ").trim();
  const n = name.toLowerCase();
  if (depth > 3) return `undefined`;
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
emit(`const DIR = join(tmpdir(), "wsfgen-${seedArg}");`);
emit(`rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });`);
emit(`const P = (s) => join(DIR, s);`);
emit(`const BIG = new Uint8Array(256 * 1024).map((_, i) => i % 251);`);
emit(`writeFileSync(P("data.txt"), "the quick brown fox jumps over the lazy dog\\n".repeat(20));`);
emit(`writeFileSync(P("big.bin"), BIG); writeFileSync(P("empty.txt"), ""); writeFileSync(P("uni-ë-🐰.txt"), "unicode name");`);
emit(`const SPAWN = [process.execPath, "-e", "process.stdin.pipe(process.stdout); setTimeout(()=>{}, 200)"];`);
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
  const m = pick(methodsByKind.get(kind)!);
  const await_ = chance(0.7) ? "await " : "";
  emit(`${await_}$step(${JSON.stringify(m.path)}, () => { const o = $pool(${JSON.stringify(kind)}); if (o == null) throw new Error("pool-empty"); return o.${m.name}(${argList(m)}); });`);
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
for (let i = 0; i < nStatements; i++) {
  const r = rnd();
  if (r < 0.22) genCreate();
  else if (r < 0.62) genMethod();
  else if (r < 0.78) genLifecycle();
  else if (r < 0.9) genCall();
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
