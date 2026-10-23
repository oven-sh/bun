// Bun's own modules ask whether a value is a typed array ($isTypedArrayView) or an array ($isJSArray) before they take its bytes or its elements. Each function gets every kind of view, a DataView, a Buffer, instances of classes below, the prototype objects, objects under them, proxies, buffers, arrays and primitives.
const { types, inspect, isDeepStrictEqual } = require("node:util");
const fs = require("node:fs"), zlib = require("node:zlib"), crypto = require("node:crypto"), { Readable, Writable } = require("node:stream"), { StringDecoder } = require("node:string_decoder");
class U extends Uint8Array {} class L extends Array {}
const values = () => [new Int8Array(2), new Uint8Array(2), new Uint8ClampedArray(2), new Int16Array(2), new Uint16Array(2), new Int32Array(2), new Uint32Array(2), new Float16Array(2), new Float32Array(2), new Float64Array(2), new BigInt64Array(2), new BigUint64Array(2), new DataView(new ArrayBuffer(2)), Buffer.from("ab"), new U(2), Uint8Array.prototype, Object.getPrototypeOf(Uint8Array.prototype), Object.create(Uint8Array.prototype), new Proxy(new Uint8Array(2), {}), new ArrayBuffer(2), new SharedArrayBuffer(2), [1, 2], new L(1, 2), Array.prototype, Object.create(Array.prototype), new Proxy([1, 2], {}), { length: 2, 0: 1, 1: 2 }, "ab", 5, null, undefined];
function attempt(run) { try { const r = run(); return typeof r === "object" && r !== null ? Object.prototype.toString.call(r) : String(r); } catch (e) { return e.code ?? e.constructor.name; } }
const sink = fs.openSync(process.platform === "win32" ? "\\\\.\\nul" : "/dev/null", "w");
const asked = {
  isTypedArray: v => types.isTypedArray(v),
  isUint8Array: v => types.isUint8Array(v),
  isArrayBufferView: v => types.isArrayBufferView(v),
  isAnyArrayBuffer: v => types.isAnyArrayBuffer(v),
  byteLength: v => Buffer.byteLength(v),
  from: v => Buffer.from(v).length,
  concat: v => Buffer.concat([v]).length,
  concatOf: v => Buffer.concat(v).length,
  compare: v => Buffer.compare(v, Buffer.from("ab")),
  equals: v => Buffer.from("ab").equals(v),
  copy: v => Buffer.from("ab").copy(v),
  isBuffer: v => Buffer.isBuffer(v),
  writeSync: v => fs.writeSync(sink, v),
  writevSync: v => fs.writevSync(sink, [v]),
  writevOf: v => fs.writevSync(sink, v),
  gzip: v => zlib.gzipSync(v).length > 0,
  hash: v => crypto.createHash("md5").update(v).digest("hex").length,
  timingSafeEqual: v => crypto.timingSafeEqual(v, v),
  push: v => new Readable({ read() {} }).on("error", () => {}).push(v),
  write: v => new Writable({ write(c, e, done) { done(); } }).on("error", () => {}).write(v),
  decode: v => new StringDecoder("utf8").write(v).length,
  textDecode: v => new TextDecoder().decode(v).length,
  blob: v => new Blob([v]).size,
  blobOf: v => new Blob(v).size,
  response: v => typeof new Response(v).body,
  inspected: v => inspect(v).length > 0,
  deepEqual: v => isDeepStrictEqual(v, v),
  spawnArguments: v => typeof require("node:child_process").spawnSync("true", v).status,
  pathJoin: v => require("node:path").join("a", ...(Array.isArray(v) ? v.map(String) : [])),
  format: v => require("node:util").format("%o", v).length > 0,
  emit: v => new (require("node:events"))().emit("x", v),
  assertArray: v => { require("node:assert").deepStrictEqual(v, v); return "equal"; },
};
for (const name in asked) { let line = ""; for (let round = 0; round < 12; round++) line = values().map(v => attempt(() => asked[name](v))).join(" "); console.log(name + ": " + line); }
