// A server-side 'data' listener throws on the first chunk. The throw must reach
// uncaughtException, no socket 'error' fires, and the next chunk still arrives.
// node: ["connection","data:A","uncaught:data-boom","data:B","close:false"]
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
    // Queued before the throw so the client can pace the next write on the ack
    // instead of time.
    s.write(".");
    if (String(d) === "A") throw new Error("data-boom");
  });
  s.on("close", had => {
    ev.push("close:" + had);
    srv.close(done);
  });
});

srv.listen(0, "127.0.0.1", () => {
  const c = net.connect(srv.address().port, "127.0.0.1", () => c.write("A"));
  let acks = 0;
  c.on("data", () => {
    if (++acks === 1) c.write("B");
    else c.end();
  });
  c.on("error", () => {});
});
