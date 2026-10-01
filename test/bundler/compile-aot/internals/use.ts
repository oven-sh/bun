import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter, once } from "node:events";
import { Readable, Transform, pipeline, PassThrough } from "node:stream";
import { promisify, inspect, format, types, parseArgs, styleText } from "node:util";
import { createHash, randomBytes, createHmac } from "node:crypto";
import zlib from "node:zlib";
import { URL, URLSearchParams, fileURLToPath } from "node:url";
import assert from "node:assert";
import { Buffer } from "node:buffer";
import querystring from "node:querystring";
import { StringDecoder } from "node:string_decoder";
import { AsyncLocalStorage } from "node:async_hooks";
import readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import child_process from "node:child_process";
import http from "node:http";
import net from "node:net";
import tty from "node:tty";
import vm from "node:vm";
import dns from "node:dns";
import diagnostics_channel from "node:diagnostics_channel";
export async function use(seed: number): Promise<string[]> {
  const out: string[] = [];
  out.push("path " + [path.join("a", "..", "b", "c.txt"), path.basename("/x/y.z", ".z"), path.relative("/a/b", "/a/c/d"), path.posix.normalize("/a//b/../c")].join());
  out.push("os " + [typeof os.cpus().length, os.EOL === "\n", typeof os.homedir()].join());
  const e = new EventEmitter(); const got: unknown[] = []; e.on("x", v => got.push(v)); e.once("x", v => got.push("once" + v)); e.emit("x", seed); e.emit("x", seed + 1); out.push("events " + got.join() + " " + e.listenerCount("x"));
  const p = once(e, "y"); e.emit("y", 1, 2); out.push("once " + (await p).join());
  const chunks: string[] = []; await promisify(pipeline)(Readable.from(["a", "b", String(seed)]), new Transform({ transform(c, _e, cb) { cb(null, String(c).toUpperCase() + "!"); } }), new PassThrough().on("data", d => chunks.push(String(d)))); out.push("stream " + chunks.join(""));
  out.push("util " + [inspect({ a: [1, { b: new Map([[1, seed]]) }], s: "x" }, { depth: 4, breakLength: Infinity }), format("%s:%d:%j", "s", seed, { j: 1 }), types.isPromise(p), styleText("red", "r").length].join(" "));
  out.push("parseArgs " + JSON.stringify(parseArgs({ args: ["-f", "--bar", "b" + seed], options: { f: { type: "boolean", short: "f" }, bar: { type: "string" } } }).values));
  out.push("crypto " + [createHash("sha256").update("x" + seed).digest("hex").slice(0, 16), createHmac("sha1", "k").update("v").digest("base64"), randomBytes(8).length].join());
  out.push("zlib " + zlib.gunzipSync(zlib.gzipSync(Buffer.from("hello".repeat(seed % 5 + 1)))).toString() + " " + zlib.inflateSync(zlib.deflateSync("abc")).toString() + " " + zlib.brotliDecompressSync(zlib.brotliCompressSync("br")).toString());
  const u = new URL("https://user:pw@example.com:8080/p/a?x=1&y=" + seed + "#h"); out.push("url " + [u.host, u.pathname, u.searchParams.get("y"), new URLSearchParams({ a: "1", b: "2 3" }).toString(), fileURLToPath("file:///tmp/x")].join());
  try { assert.deepStrictEqual({ a: 1, b: [seed] }, { a: 1, b: [seed + 1] }); } catch (err: any) { out.push("assert " + err.code + " " + err.name + " " + String(err.message).split("\n")[0]); }
  out.push("buffer " + [Buffer.from("héllo").toString("base64"), Buffer.concat([Buffer.alloc(2, 1), Buffer.from([seed & 255])]).toString("hex"), Buffer.byteLength("€"), Buffer.from("616263", "hex").readUInt16BE(1)].join());
  out.push("qs " + querystring.stringify({ a: [1, 2], b: "c d" }) + " " + JSON.stringify(querystring.parse("x=1&x=2&y=z")));
  const d = new StringDecoder("utf8"); out.push("decoder " + d.write(Buffer.from([0xe2, 0x82])) + d.write(Buffer.from([0xac])) + d.end());
  const als = new AsyncLocalStorage<number>(); out.push("als " + await als.run(seed, async () => { await sleep(1); return als.getStore(); }));
  const lines: string[] = []; const rl = readline.createInterface({ input: Readable.from(["l1\nl2\n", "l" + seed + "\n"]) }); for await (const l of rl) lines.push(l); out.push("readline " + lines.join());
  out.push("perf " + [typeof performance.now(), typeof performance.timeOrigin].join());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-int-")); const f = path.join(dir, "f.txt"); fs.writeFileSync(f, "data" + seed); fs.appendFileSync(f, "+"); out.push("fs " + [fs.readFileSync(f, "utf8"), fs.existsSync(f), fs.statSync(f).size, (await fs.promises.readdir(dir)).join(), fs.readdirSync(dir, { withFileTypes: true })[0]!.isFile()].join()); const rs: string[] = []; for await (const c of fs.createReadStream(f, { encoding: "utf8", highWaterMark: 3 })) rs.push(c as string); out.push("fsstream " + rs.join("|")); fs.rmSync(dir, { recursive: true });
  out.push("child " + child_process.execFileSync("/bin/echo", ["hi", String(seed)]).toString().trim() + " " + child_process.spawnSync("/usr/bin/true").status);
  const server = http.createServer((req, res) => { res.setHeader("x-seed", String(seed)); res.end("ok:" + req.url); }); await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); const port = (server.address() as net.AddressInfo).port;
  const body = await new Promise<string>((resolve, reject) => http.get({ host: "127.0.0.1", port, path: "/q" + seed }, res => { let b = ""; res.on("data", c => (b += c)); res.on("end", () => resolve(res.statusCode + ":" + res.headers["x-seed"] + ":" + b)); }).on("error", reject)); server.close(); out.push("http " + body);
  out.push("misc " + [net.isIP("127.0.0.1"), net.isIPv6("::1"), typeof tty.isatty(0), vm.runInNewContext("a + 1", { a: seed }), typeof dns.lookup, diagnostics_channel.channel("c").hasSubscribers].join());
  try { fs.readFileSync("/nonexistent/" + seed); } catch (err: any) { out.push("enoent " + [err.code, err.syscall, err.errno, String(err.stack).split("\n").length > 1].join()); }
  try { new (EventEmitter as any)().emit("error", new Error("boom" + seed)); } catch (err: any) { out.push("emiterror " + err.message + " " + String(err.stack).split("\n").slice(1, 3).map(l => l.trim().replace(/\(.*[\\/]/, "(").replace(/:\d+:\d+/, "")).join(" < ")); }
  return out;
}
