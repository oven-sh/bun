// A strict build must refuse anything that would freeze an OS socket into the snapshot: servers and UDP sockets included.
function attempt(name, make) {
  try { const s = make(); s.stop?.(true); s.close?.(); console.log(`[js] ${name} created`); }
  catch (e) { console.log(`[js] ${name} refused`); }
}
attempt("serve", () => Bun.serve({ port: 0, fetch: () => new Response("x") }));
attempt("udp", () => Bun.udpSocket({ port: 0 }));
// node:fs ops implemented outside the generated table must be gated like the rest.
const fs = require("fs");
attempt("readdir", () => fs.readdirSync("."));
attempt("cp", () => fs.cpSync(process.execPath, process.env.CP_TARGET, {}));
attempt("watch", () => fs.watch("."));
attempt("readdir-async", () => fs.readdir(".", () => {})); // the callback forms are the hand-written bindings
attempt("cp-async", () => fs.cp(process.execPath, process.env.CP_TARGET, {}, () => {}));
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
