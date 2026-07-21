// scenario: sockets — AFD device ioctls, IOCP completions (NtDeviceIoControlFile,
// NtRemoveIoCompletionEx). HTTP server+fetch, raw TCP echo, DNS, UDP.
const net = require("net");
const dgram = require("dgram");
const dns = require("dns/promises");

// HTTP: Bun.serve + fetch, several sequential + concurrent requests
const server = Bun.serve({ port: 0, fetch: req => new Response("H:" + new URL(req.url).pathname) });
const base = `http://127.0.0.1:${server.port}`;
const bodies = await Promise.all([1, 2, 3, 4].map(i => fetch(`${base}/p${i}`).then(r => r.text())));
server.stop(true);

// raw TCP echo via node:net
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
const udpResult = await new Promise(resolve => {
  const s = dgram.createSocket("udp4");
  s.on("message", (m, r) => {
    resolve(m.toString());
    s.close();
  });
  s.bind(0, "127.0.0.1", () => s.send("pong", s.address().port, "127.0.0.1"));
});

// DNS
let dnsHost = "?";
try {
  dnsHost = (await dns.lookup("localhost")).address;
} catch (e) {
  dnsHost = "err:" + e.code;
}

console.log(`net ok http=${bodies.join(",")} tcp=${tcpResult} udp=${udpResult} dns=${dnsHost}`);
