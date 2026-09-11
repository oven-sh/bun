// Fixture for proxy.test.ts: fetch with an Upgrade header and a streaming
// body through a CONNECT proxy to an HTTPS origin, where the origin's 101
// response and a TLS record that cannot be decrypted reach the client in one
// packet.
//
// The client's SSLWrapper decrypts the 101 and dispatches it; the 101 arm of
// handle_on_data_headers calls flush_stream, whose write reaches SSL_write on
// an SSL that the same read already made fatal. write_data then closed the
// wrapper, ProxyTunnel::on_close freed the HTTPClient, and the 101 arm kept
// reading it (ASAN: heap-use-after-free in handle_response_metadata).
//
// Usage: bun proxy-upgrade-fatal-record-fixture.ts [iterations]
// Prints one line per iteration, then "injected: <n>" (how many connections
// got the bad record) and "probe: <text>" from a fresh request.

import net from "node:net";
import { tls as tlsCert } from "harness";

const iterations = Number(process.argv[2] ?? "3");
// How many connections actually got the bad record. A run where the upgrade
// fails earlier proves nothing, so the test asserts this count.
let injected = 0;

// The origin answers the first request with a bare 101 and nothing else.
using origin = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: tlsCert,
  socket: {
    data(socket) {
      if (socket.data?.answered) return;
      socket.data = { answered: true };
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: foo\r\nConnection: Upgrade\r\n\r\n");
    },
    error() {},
    close() {},
  },
});

// application_data, 32 bytes of ciphertext that cannot authenticate.
const BAD_RECORD = Buffer.concat([Buffer.from([0x17, 0x03, 0x03, 0x00, 0x20]), Buffer.alloc(32, 0x42)]);

const proxy = net.createServer(client => {
  let upstream: net.Socket | null = null;
  let head = Buffer.alloc(0);
  let clientFlights = 0;
  let held = Buffer.alloc(0);
  let poisoned = false;

  // Hold the origin's records until the 101 response record is complete, then
  // send it with the bad record appended, so one read decrypts both.
  function flushWithBadRecord() {
    let offset = 0;
    let sawResponse = false;
    while (offset + 5 <= held.length) {
      const len = held.readUInt16BE(offset + 3);
      if (offset + 5 + len > held.length) return;
      // The 101 record is ~90 bytes of ciphertext. Session tickets are larger.
      if (held[offset] === 0x17 && len >= 70 && len <= 140) sawResponse = true;
      offset += 5 + len;
    }
    if (offset !== held.length || !sawResponse) return;
    poisoned = true;
    // Wait for the body generator's first chunk to be queued, so the 101 arm
    // has something for flush_stream to write.
    setTimeout(() => {
      if (client.destroyed) return;
      client.write(Buffer.concat([held, BAD_RECORD]));
      held = Buffer.alloc(0);
      injected++;
    }, 500);
  }

  client.on("error", () => {});
  client.on("close", () => upstream?.destroy());
  client.on("data", chunk => {
    if (!upstream) {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      const leftover = head.subarray(end + 4);
      upstream = net.connect(origin.port, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (leftover.length) upstream!.write(leftover);
      });
      upstream.on("error", () => {});
      upstream.on("data", data => {
        if (poisoned) return;
        // The first two client flights are the ClientHello and the rest of the
        // handshake; hold only what follows them.
        if (clientFlights >= 2) {
          held = Buffer.concat([held, data]);
          flushWithBadRecord();
        } else {
          client.write(data);
        }
      });
      return;
    }
    clientFlights++;
    upstream.write(chunk);
  });
});
using _proxy = { [Symbol.dispose]: () => proxy.close() };
proxy.listen(0, "127.0.0.1");
await new Promise<void>(resolve => proxy.once("listening", () => resolve()));
const proxyPort = (proxy.address() as net.AddressInfo).port;

for (let i = 0; i < iterations; i++) {
  let outcome: string;
  try {
    const res = await fetch(`https://localhost:${origin.port}/`, {
      proxy: `http://127.0.0.1:${proxyPort}`,
      headers: { Upgrade: "foo", Connection: "Upgrade" },
      tls: { ca: tlsCert.cert, rejectUnauthorized: false },
      // A generator body keeps the request stream open past the response, so
      // the 101 arm has something to flush.
      async *body() {
        yield Buffer.alloc(1024, 0x61);
        await Bun.sleep(5000);
      },
    });
    try {
      outcome = `resolved:${res.status}:${(await res.bytes()).length}`;
    } catch (e: any) {
      outcome = `body-rejected:${res.status}:${e?.code ?? e?.name ?? String(e)}`;
    }
  } catch (e: any) {
    outcome = `rejected:${e?.code ?? e?.name ?? String(e)}`;
  }
  console.log(outcome);
}

console.log("injected:", injected);

// A request on a fresh connection proves the process and the HTTP thread are
// still healthy.
using probeOrigin = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("probe-ok") });
const probe = await fetch(`https://localhost:${probeOrigin.port}/`, {
  tls: { ca: tlsCert.cert, rejectUnauthorized: false },
});
console.log("probe:", await probe.text());
