// Prints the TLS 1.2 suite every kind of client negotiates: with nothing assigned to tls.DEFAULT_CIPHERS, then after
// each assignment. NODE_EXTRA_CA_CERTS holds the certificate of the servers.
import { tls as cert } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
import { Worker } from "node:worker_threads";
import { MYSQL_CLIENT_SSL, MYSQL_DEFAULT_CAPABILITIES, mysqlHandshakeV10, pgSSLResponse } from "../../sql/wire-frames";

const AES128 = "ECDHE-RSA-AES128-GCM-SHA256";
const AES256 = "ECDHE-RSA-AES256-GCM-SHA384";
// Prefers AES128, as every client does until it is told otherwise.
const serverOptions = {
  key: cert.key,
  cert: cert.cert,
  maxVersion: "TLSv1.2",
  ciphers: `${AES128}:${AES256}`,
} as const;

/** The suite of each handshake of the client under test, or the error that ended one. */
let reports: string[] = [];
let reported = () => {};
function report(outcome: string) {
  reports.push(outcome);
  reported();
}
async function listen(server: net.Server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return (server.address() as net.AddressInfo).port;
}
function tlsServer(onSecure: (socket: tls.TLSSocket) => void) {
  const server = tls.createServer(serverOptions, socket => {
    report(socket.getCipher().name);
    socket.on("error", () => {});
    onSecure(socket);
  });
  server.on("tlsClientError", error => report((error as NodeJS.ErrnoException).code!));
  return listen(server);
}

const ok = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const origin = await tlsServer(socket => socket.once("data", () => socket.end(ok)));

function tunnel(socket: net.Socket) {
  socket.on("error", () => {});
  socket.once("data", () => {
    const upstream = net.connect(origin, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
  });
}
const httpProxy = `http://localhost:${await listen(net.createServer(tunnel))}`;
const httpsProxy = `https://localhost:${await tlsServer(tunnel)}`;

/** The TLS half of a database server, once its plaintext prelude is done. */
function upgrade(raw: net.Socket, leftover: Buffer) {
  raw.pause();
  if (leftover.length) raw.unshift(leftover);
  const socket = new tls.TLSSocket(raw, { isServer: true, ...serverOptions });
  socket.on("secure", () => (report(socket.getCipher().name), socket.destroy()));
  socket.on("error", error => report((error as NodeJS.ErrnoException).code!));
}
const postgres = await listen(
  net.createServer(raw => {
    raw.on("error", () => {});
    raw.once("data", chunk => {
      raw.write(pgSSLResponse("S"));
      upgrade(raw, chunk.subarray(8));
    });
  }),
);
const mysql = await listen(
  net.createServer(raw => {
    raw.on("error", () => {});
    raw.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }));
    let buffered = Buffer.alloc(0);
    raw.on("data", function onData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const end = 4 + (buffered[0] | (buffered[1] << 8) | (buffered[2] << 16));
      if (buffered.length < 4 || buffered.length < end) return;
      raw.removeListener("data", onData);
      upgrade(raw, buffered.subarray(end));
    });
  }),
);

const url = `https://localhost:${origin}/`;
const wss = `wss://localhost:${origin}/`;
const sql = (adapter: "postgres" | "mysql", port: number) =>
  new Bun.SQL({ adapter, hostname: "localhost", port, username: "u", database: "d", tls: true, max: 1 }).connect();
const s3 = () => new Bun.S3Client({ endpoint: url.slice(0, -1), accessKeyId: "a", secretAccessKey: "b", bucket: "c" });

/** How many handshakes it takes, and how to start it. */
const clients: Record<string, [number, () => unknown]> = {
  "fetch": [1, () => fetch(url, { keepalive: false })],
  "fetch, tls: {}": [1, () => fetch(url, { keepalive: false, tls: {} })],
  "fetch, rejectUnauthorized": [1, () => fetch(url, { keepalive: false, tls: { rejectUnauthorized: false } })],
  "fetch, ca": [1, () => fetch(url, { keepalive: false, tls: { ca: cert.cert } })],
  "fetch, http proxy": [1, () => fetch(url, { keepalive: false, proxy: httpProxy })],
  "fetch, https proxy": [2, () => fetch(url, { keepalive: false, proxy: httpsProxy })],
  "WebSocket": [1, () => void new WebSocket(wss)],
  "WebSocket, rejectUnauthorized": [1, () => void new WebSocket(wss, { tls: { rejectUnauthorized: false } })],
  "WebSocket, http proxy": [1, () => void new WebSocket(wss, { proxy: httpProxy })],
  "WebSocket, https proxy": [2, () => void new WebSocket(wss, { proxy: httpsProxy })],
  "RedisClient, tls: true": [
    1,
    () => new Bun.RedisClient(`rediss://localhost:${origin}`, { tls: true, autoReconnect: false }).connect(),
  ],
  "Bun.connect, tls: true": [
    1,
    () => Bun.connect({ hostname: "localhost", port: origin, tls: true, socket: { data() {}, error() {} } }),
  ],
  "Bun.SQL postgres, tls: true": [1, () => sql("postgres", postgres)],
  "Bun.SQL mysql, tls: true": [1, () => sql("mysql", mysql)],
  "S3Client, text()": [1, () => s3().file("x").text()],
  "S3Client, stream()": [1, () => s3().file("x").stream().getReader().read()],
  "S3Client, list()": [1, () => s3().list()],
};

async function outcome(handshakes: number, connect: () => unknown) {
  reports = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  reported = () => void ((reports.length === handshakes || !reports.at(-1)!.startsWith("ECDHE-")) && resolve());
  Promise.resolve(connect()).catch(() => {});
  await promise;
  return reports.join(", ");
}

const results: Record<string, string[] | string> = {};
for (const list of [undefined, AES256, AES128, "TLS_AES_128_GCM_SHA256"]) {
  if (list) tls.DEFAULT_CIPHERS = list;
  for (const [name, [handshakes, connect]] of Object.entries(clients)) {
    ((results[name] ??= []) as string[]).push(await outcome(handshakes, connect));
  }
}
// The list is the thread's, as in Node.js.
results.worker = await outcome(1, () => new Worker(`new WebSocket(${JSON.stringify(wss)})`, { eval: true }));
console.log(JSON.stringify(results));
process.exit(0);
