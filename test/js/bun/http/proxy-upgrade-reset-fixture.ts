// An https proxy passes on the end of the origin's handshake and its 101, then resets the connection.
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";

// In TLS 1.2 the origin's Finished ends the handshake, so the 101 can be right behind it.
const origin = tls.createServer({ ...tlsCert, maxVersion: "TLSv1.2" }, socket => {
  socket.on("error", () => {});
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: foo\r\nConnection: Upgrade\r\n\r\n");
});
await once(origin.listen(0, "127.0.0.1"), "listening");
const originPort = (origin.address() as net.AddressInfo).port;

const CHANGE_CIPHER_SPEC = 20;
const APPLICATION_DATA = 23;
const writeAndReset = Promise.withResolvers<() => void>();

using proxy = Bun.listen<{ head: string; upstream?: net.Socket }>({
  hostname: "127.0.0.1",
  port: 0,
  tls: tlsCert,
  socket: {
    open(client) {
      client.data = { head: "" };
    },
    data(client, chunk) {
      if (client.data.upstream) return void client.data.upstream.write(chunk);
      client.data.head += chunk.toString("latin1");
      if (!client.data.head.endsWith("\r\n\r\n")) return;

      const upstream = net.connect(originPort, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      });
      client.data.upstream = upstream;
      let unparsed = Buffer.alloc(0);
      const held: Buffer[] = [];
      upstream.on("error", writeAndReset.reject);
      upstream.on("close", () => writeAndReset.reject(new Error("the origin closed before its 101")));
      upstream.on("data", data => {
        unparsed = Buffer.concat([unparsed, data]);
        while (unparsed.length >= 5 && unparsed.length >= 5 + unparsed.readUInt16BE(3)) {
          const record = unparsed.subarray(0, 5 + unparsed.readUInt16BE(3));
          unparsed = unparsed.subarray(record.length);
          if (held.length === 0 && record[0] !== CHANGE_CIPHER_SPEC) {
            client.write(record);
            continue;
          }
          held.push(record);
          if (record[0] !== APPLICATION_DATA) continue;
          writeAndReset.resolve(() => {
            client.write(Buffer.concat(held));
            client.terminate();
          });
        }
      });
    },
    close(client) {
      client.data.upstream?.destroy();
    },
    error() {},
  },
});

const upgrade = fetch(`https://localhost:${originPort}/`, {
  method: "POST",
  proxy: `https://127.0.0.1:${proxy.port}`,
  headers: { Upgrade: "foo", Connection: "Upgrade" },
  tls: { rejectUnauthorized: false },
  body: new ReadableStream({ pull() {} }),
}).then(
  res => res.status,
  e => e.code,
);
upgrade.then(result => writeAndReset.reject(new Error(`fetch settled before the 101: ${result}`)));
const release = await writeAndReset.promise;

// The HTTP thread blocks on `caFile`, so it finds the records and the reset together once the FIFO closes.
const fifo = process.argv[2];
const blocker = fetch(`https://localhost:${originPort}/`, { tls: { caFile: fifo } }).catch(e => e.code);
const writer = await Promise.race([fs.promises.open(fifo, "w"), blocker.then(code => Promise.reject(new Error(code)))]);
// The client's socket is in state 01 (established) until the reset has reached it.
const established = new RegExp(`^ *\\d+: \\S+ 0100007F:${proxy.port.toString(16).padStart(4, "0")} 01 `, "im");
const isConnectedToProxy = () => established.test(fs.readFileSync("/proc/net/tcp", "latin1"));
if (!isConnectedToProxy()) throw new Error("the connection to the proxy is not in /proc/net/tcp");
release();
const deadline = Date.now() + 2_000;
while (isConnectedToProxy()) {
  if (Date.now() > deadline) throw new Error("the reset did not arrive");
  await new Promise(setImmediate);
}
await writer.close();

using probeOrigin = Bun.serve({ port: 0, fetch: () => new Response("probe-ok") });
console.log(
  JSON.stringify({
    upgrade: await upgrade,
    blocker: await blocker,
    probe: await (await fetch(probeOrigin.url)).text(),
  }),
);
origin.close();
