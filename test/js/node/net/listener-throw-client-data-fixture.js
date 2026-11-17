// A client-side 'data' listener throws on the first chunk. The throw must reach
// uncaughtException, no socket 'error' fires, and the next chunk still arrives.
// node: ["data:A","uncaught:data-boom","data:B","close:false"]
const net = require("node:net");

const ev = [];
const done = () => {
  console.log(JSON.stringify(ev));
  process.exit(0);
};
process.on("uncaughtException", e => ev.push("uncaught:" + e.message));

const srv = net.createServer(s => {
  s.write("A");
  s.once("data", () => s.end("B"));
});

srv.listen(0, "127.0.0.1", () => {
  const c = net.connect(srv.address().port, "127.0.0.1");
  c.on("error", e => ev.push("socket-error:" + e.message));
  c.on("data", d => {
    ev.push("data:" + d);
    if (String(d) === "A") {
      c.write(".");
      throw new Error("data-boom");
    }
  });
  c.on("close", had => {
    ev.push("close:" + had);
    srv.close(done);
  });
});
