// A strict build must refuse anything that would freeze an OS socket into the snapshot: servers and UDP sockets included.
function attempt(name, make) {
  try { const s = make(); s.stop?.(true); s.close?.(); console.log(`[js] ${name} created`); }
  catch (e) { console.log(`[js] ${name} refused`); }
}
attempt("serve", () => Bun.serve({ port: 0, fetch: () => new Response("x") }));
attempt("udp", () => Bun.udpSocket({ port: 0 }));
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
