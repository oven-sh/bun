// https://github.com/oven-sh/bun/issues/34064: the pg pool shape. A 'data'
// listener re-emits 'error' on an emitter with no listeners, so emit() throws.
// node: ["uncaught:pool error","close:false"]
const net = require("node:net");
const { EventEmitter } = require("node:events");

const ev = [];
const done = () => {
  console.log(JSON.stringify(ev));
  process.exit(0);
};
process.on("uncaughtException", e => ev.push("uncaught:" + e.message));

const pool = new EventEmitter();
const srv = net.createServer(s => s.end("x"));

srv.listen(0, "127.0.0.1", () => {
  const c = net.connect(srv.address().port, "127.0.0.1");
  c.on("error", e => ev.push("socket-error:" + e.message));
  c.on("data", () => pool.emit("error", new Error("pool error")));
  c.on("close", had => {
    ev.push("close:" + had);
    srv.close(done);
  });
});
