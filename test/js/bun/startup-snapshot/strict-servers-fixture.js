// A strict build must refuse anything that would freeze an OS socket into the snapshot: servers and UDP sockets included.
async function attempt(name, make) {
  try {
    let s = make();
    if (s && typeof s.then === "function") s = await s; // the Bun.file/Bun.write forms reject rather than throw
    s?.stop?.(true); s?.close?.();
    console.log(`[js] ${name} created`);
  } catch (e) { console.log(`[js] ${name} refused`); }
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
// ...but stdio is each launch's own and must stay usable while building (process.stdin is built on the same machinery).
queue("stdout-write", () => Bun.write(Bun.stdout, ""));
queue("stdin-access", () => { if (!process.stdin) throw new Error("no stdin"); });
(async () => { for (const [n, m] of attempts) await attempt(n, m); Bun.startupSnapshot.take({ timers: "cancel" }); })();
