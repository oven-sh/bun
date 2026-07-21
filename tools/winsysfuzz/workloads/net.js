// scenario: sockets — AFD device ioctls, IOCP completions (NtDeviceIoControlFile,
// NtRemoveIoCompletionEx). HTTP server+fetch, raw TCP echo, DNS, UDP.
// STAGE: markers localize a hang/crash to a step in the finding report.
const net = require("net");
const dgram = require("dgram");
const dns = require("dns/promises");
const stage = s => console.log("STAGE: " + s);

// HTTP: Bun.serve + fetch, several sequential + concurrent requests
stage("http-serve-and-fetch");
const server = Bun.serve({ port: 0, fetch: req => new Response("H:" + new URL(req.url).pathname) });
const base = `http://127.0.0.1:${server.port}`;
const bodies = await Promise.all([1, 2, 3, 4].map(i => fetch(`${base}/p${i}`).then(r => r.text())));
server.stop(true);

// raw TCP echo via node:net
stage("tcp-echo");
const tcpResult = await new Promise((resolve, reject) => {
  const srv = net.createServer(sock => sock.pipe(sock));
  srv.listen(0, "127.0.0.1", () => {
    const c = net.connect(srv.address().port, "127.0.0.1", () => c.write("ping"));
    c.on("data", d => {
      resolve(d.toString());
      c.destroy();
      srv.close();
    });
    c.on("error", reject);
  });
});

// UDP round-trip
stage("udp-roundtrip");
const udpResult = await new Promise(resolve => {
  const s = dgram.createSocket("udp4");
  s.on("message", (m, r) => {
    resolve(m.toString());
    s.close();
  });
  s.on("error", e => resolve("err:" + e.code));
  s.bind(0, "127.0.0.1", () => s.send("pong", s.address().port, "127.0.0.1"));
});

// DNS
stage("dns-lookup");
let dnsHost = "?";
try {
  dnsHost = (await dns.lookup("localhost")).address;
} catch (e) {
  dnsHost = "err:" + e.code;
}

stage("done");
console.log(`net ok http=${bodies.join(",")} tcp=${tcpResult} udp=${udpResult} dns=${dnsHost}`);
