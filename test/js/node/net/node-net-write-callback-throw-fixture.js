// The callback of a write that waited for the peer to read throws. The throw must
// reach uncaughtException, no socket 'error' fires, and the socket keeps writing.
// node: ["waited:true","write#1","uncaught:write-boom","write#2","end","close:false"]
const net = require("node:net");

const ev = [];
const done = () => {
  console.log(JSON.stringify(ev));
  process.exit(0);
};
process.on("uncaughtException", e => ev.push("uncaught:" + e.message));

// More than a kernel takes from a peer that reads nothing.
const BIG = Buffer.alloc(4 * 1024 * 1024, "a");
let client;

const srv = net.createServer(s => {
  s.on("error", e => ev.push("socket-error:" + e.message));
  s.on("close", had => {
    ev.push("close:" + had);
    srv.close(done);
  });
  s.write(BIG, () => {
    ev.push("write#1");
    throw new Error("write-boom");
  });
  s.write(BIG, () => ev.push("write#2"));
  ev.push("waited:" + (s.writableLength > 0));
  s.end(() => ev.push("end"));
  client.resume();
});

srv.listen(0, "127.0.0.1", () => {
  client = net.connect(srv.address().port, "127.0.0.1");
  client.pause();
  client.on("end", () => client.end());
  client.on("error", () => {});
});
