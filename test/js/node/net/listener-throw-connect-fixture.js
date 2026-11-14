// A client 'connect' or 'ready' listener (THROW_FROM) throws. The throw must reach
// uncaughtException, not the socket's 'error' event, and the socket stays connected.
// node, THROW_FROM=connect: ["connect","uncaught:connect-boom","server-data:A","close:false"]
// node, THROW_FROM=ready: ["connect","ready","uncaught:ready-boom","server-data:A","close:false"]
const net = require("node:net");

const throwFrom = process.env.THROW_FROM;
const ev = [];
let c;
process.on("uncaughtException", e => {
  ev.push("uncaught:" + e.message);
  c.write("A");
});

const srv = net.createServer(s => {
  s.on("error", () => {});
  s.on("data", d => {
    ev.push("server-data:" + d);
    c.destroy();
  });
});

srv.listen(0, "127.0.0.1", () => {
  c = net.connect(srv.address().port, "127.0.0.1");
  for (const name of ["connect", "ready"]) {
    c.on(name, () => {
      ev.push(name);
      if (name === throwFrom) throw new Error(name + "-boom");
    });
  }
  c.on("error", e => ev.push("socket-error:" + e.message));
  c.on("close", had => {
    ev.push("close:" + had);
    console.log(JSON.stringify(ev));
    process.exit(0);
  });
});
