// A strict build must refuse anything that would freeze an OS socket into the snapshot: servers and UDP sockets included.
async function attempt(name, make) {
  try {
    let s = make();
    if (s && typeof s.then === "function") s = await s; // the Bun.file/Bun.write forms reject rather than throw
    s?.stop?.(true); s?.close?.();
    console.log(`[js] ${name} created`);
  } catch (e) {
    console.log(String(e?.message ?? e).includes("while building a snapshot") ? `[js] ${name} refused` : `[js] ${name} failed otherwise: ${String(e?.message ?? e).slice(0, 40)}`);
  }
}
const attempts = [];
const queue = (name, make) => attempts.push([name, make]);
queue("serve", () => Bun.serve({ port: 0, fetch: () => new Response("x") }));
queue("udp", () => Bun.udpSocket({ port: 0 }));
// node:fs ops implemented outside the generated table must be gated like the rest.
const fs = require("fs");
queue("readdir", () => fs.readdirSync("."));
queue("cp", () => fs.cpSync(process.execPath, process.env.CP_TARGET, {}));
queue("watch", () => fs.watch("."));
queue("readdir-async", () => new Promise((res, rej) => fs.readdir(".", e => (e ? rej(e) : res())))); // the callback forms are the hand-written bindings
queue("cp-async", () => new Promise((res, rej) => fs.cp(process.execPath, process.env.CP_TARGET, {}, e => (e ? rej(e) : res())))); // refused through the callback, as node delivers errors
// Bun's own file APIs are gated too, not just node:fs.
queue("bun-write", () => Bun.write(process.env.CP_TARGET, "x"));
queue("bun-file-text", () => Bun.file(process.execPath).text());
queue("bun-file-exists", () => Bun.file(process.execPath).exists());
queue("bun-file-stat", () => Bun.file(process.execPath).stat());
queue("bun-file-delete", () => Bun.file(process.env.CP_TARGET).delete()); // a path that does not exist: ungated, this fails with ENOENT rather than "refused"
queue("s3-blob-stat", () => Bun.s3.file("k", { bucket: "b", endpoint: "http://127.0.0.1:9", accessKeyId: "a", secretAccessKey: "b" }).stat());
queue("s3-blob-delete", () => Bun.s3.file("k", { bucket: "b", endpoint: "http://127.0.0.1:9", accessKeyId: "a", secretAccessKey: "b" }).delete());
queue("s3-client-stat", () => Bun.s3.stat("k", { bucket: "b", endpoint: "http://127.0.0.1:9", accessKeyId: "a", secretAccessKey: "b" })); // the client-level entries are a separate family from the blob methods
queue("s3-client-write", () => Bun.s3.write("k", "x", { bucket: "b", endpoint: "http://127.0.0.1:9", accessKeyId: "a", secretAccessKey: "b" }));
queue("s3-client-list", () => Bun.s3.list({}, { bucket: "b", endpoint: "http://127.0.0.1:9", accessKeyId: "a", secretAccessKey: "b" }));
queue("s3-blob-text", () => Bun.s3.file("k", { bucket: "b", endpoint: "http://127.0.0.1:9", accessKeyId: "a", secretAccessKey: "b" }).text()); // an S3-backed blob is network I/O
// ...but stdio is each launch's own and must stay usable while building (process.stdin is built on the same machinery).
queue("stdout-write", () => Bun.write(Bun.stdout, ""));
queue("stdin-access", () => { if (!process.stdin) throw new Error("no stdin"); });
(async () => { for (const [n, m] of attempts) await attempt(n, m); Bun.startupSnapshot.take({ timers: "cancel" }); })();
