// The createServer(handler) connection listener throws. The throw must reach
// uncaughtException, not the server or socket 'error' event, and the accepted
// connection keeps reading.
// node: ["connection","uncaught:conn-boom","data:A","data:B","close:false"]
const net = require("node:net");

const ev = [];
const done = () => {
  console.log(JSON.stringify(ev));
  process.exit(0);
};
process.on("uncaughtException", e => ev.push("uncaught:" + e.message));

const srv = net.createServer(s => {
  ev.push("connection");
  s.on("error", e => ev.push("socket-error:" + e.message));
  s.on("data", d => {
    ev.push("data:" + d);
    s.write(".");
  });
  s.on("close", had => {
    ev.push("close:" + had);
    srv.close(done);
  });
  throw new Error("conn-boom");
});
srv.on("error", e => ev.push("server-error:" + e.message));

srv.listen(0, "127.0.0.1", () => {
  const c = net.connect(srv.address().port, "127.0.0.1", () => c.write("A"));
  let acks = 0;
  c.on("data", () => {
    if (++acks === 1) c.write("B");
    else c.end();
  });
  c.on("error", () => {});
});
