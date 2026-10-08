// TLS variant of listener-throw-client-data-fixture.js. TLS_FIXTURE is the
// JSON-encoded { cert, key } pair to serve with.
// node: ["data:A","uncaught:data-boom","data:B","close:false"]
const tls = require("node:tls");

const cert = JSON.parse(process.env.TLS_FIXTURE);
const ev = [];
const done = () => {
  console.log(JSON.stringify(ev));
  process.exit(0);
};
process.on("uncaughtException", e => ev.push("uncaught:" + e.message));

const srv = tls.createServer(cert, s => {
  s.write("A");
  s.once("data", () => s.end("B"));
});

srv.listen(0, "127.0.0.1", () => {
  const c = tls.connect({ port: srv.address().port, host: "127.0.0.1", ca: cert.cert, servername: "localhost" });
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
