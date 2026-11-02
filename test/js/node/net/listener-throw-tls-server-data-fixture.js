// TLS variant of listener-throw-server-data-fixture.js. TLS_FIXTURE is the
// JSON-encoded { cert, key } pair to serve with.
// node: ["secureConnection","data:A","uncaught:data-boom","data:B","close:false"]
const tls = require("node:tls");

const cert = JSON.parse(process.env.TLS_FIXTURE);
const ev = [];
const done = () => {
  console.log(JSON.stringify(ev));
  process.exit(0);
};
process.on("uncaughtException", e => ev.push("uncaught:" + e.message));

const srv = tls.createServer(cert, s => {
  ev.push("secureConnection");
  s.on("error", e => ev.push("socket-error:" + e.message));
  s.on("data", d => {
    ev.push("data:" + d);
    s.write(".");
    if (String(d) === "A") throw new Error("data-boom");
  });
  s.on("close", had => {
    ev.push("close:" + had);
    srv.close(done);
  });
});

srv.listen(0, "127.0.0.1", () => {
  const c = tls.connect({ port: srv.address().port, host: "127.0.0.1", ca: cert.cert, servername: "localhost" }, () =>
    c.write("A"),
  );
  let acks = 0;
  c.on("data", () => {
    if (++acks === 1) c.write("B");
    else c.end();
  });
  c.on("error", e => ev.push("client-error:" + e.message));
});
