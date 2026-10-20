// Fixture for the write-limit test in node-tls-connect.test.ts.
//
// One SSL_write takes at most 2^31 - 1 bytes. Each case makes one write at or above that on a TLS socket that runs
// over a stream, and reports how the write ended. It has a process of its own because a build that does not refuse
// the longer chunk seals 2 GiB of it.
import { once } from "node:events";
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import tls, { TLSSocket } from "node:tls";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const serverOptions = {
  isServer: true,
  key: fs.readFileSync(path.join(fixturesDir, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem")),
};
const limit = 2 ** 31 - 1;

// Never written, so an OS that commits memory on first use commits none of it.
const above = Buffer.alloc(limit + 1);

// A string of `units` UTF-16 units that no flat copy backs.
function rope(units: number) {
  let out = "";
  for (let piece = "x"; units > 0; units = Math.floor(units / 2)) {
    if (units & 1) out += piece;
    if (units > 1) piece += piece;
  }
  return out;
}

// How one write() of `chunk` ends on `socket`: what its callback got, and what the socket reported.
function outcomeOfWrite(socket: net.Socket, chunk: string | Buffer, encoding?: string) {
  const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
  const errors: unknown[] = [];
  let callbacks = 0;
  let error: NodeJS.ErrnoException | null | undefined;
  socket.on("error", (err: NodeJS.ErrnoException) => errors.push(err.code));
  socket.on("close", () => resolve({ code: error?.code, syscall: error?.syscall, callbacks, errors }));
  socket.write(chunk as string, encoding as BufferEncoding, err => {
    callbacks++;
    error = err;
  });
  return promise;
}

// A TLS client over an in-memory Duplex, after its handshake.
async function connectedClient() {
  let writes = 0;
  const clientSide: Duplex = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      // A build that does not refuse the chunk seals it. Its ciphertext goes no further than here.
      if (chunk.length > 2 ** 26) {
        console.log(JSON.stringify({ sealed: chunk.length }));
        process.exit(1);
      }
      writes++;
      serverSide.push(chunk);
      callback();
    },
  });
  const serverSide: Duplex = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      clientSide.push(chunk);
      callback();
    },
  });
  const server = new TLSSocket(serverSide, serverOptions);
  server.on("error", () => {});
  server.resume();
  const client = tls.connect({ socket: clientSide, rejectUnauthorized: false });
  await once(client, "secureConnect");
  return { client, transportWrites: () => writes };
}

async function afterTheHandshake(chunk: string | Buffer, encoding?: string) {
  const { client, transportWrites } = await connectedClient();
  const before = transportWrites();
  return { ...(await outcomeOfWrite(client, chunk, encoding)), transportWrites: transportWrites() - before };
}

// A closed handle fails every write before anything takes the chunk, so a chunk that is not refused costs nothing there.
function onItsClosedHandle(socket: net.Socket, chunk: Buffer) {
  (socket as any)._handle.close();
  return outcomeOfWrite(socket, chunk);
}

async function connectedTCPSocket() {
  const server = net.createServer(accepted => accepted.on("error", () => {}).resume());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
  await once(socket, "connect");
  server.close();
  return socket;
}

// The write waits in node:net for the TCP connect of the socket under the TLS socket.
async function beforeTheTransportConnects(chunk: Buffer) {
  const server = net.createServer(accepted => accepted.on("error", () => {}).resume());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const raw = new net.Socket();
  raw.on("error", () => {});
  const socket = new TLSSocket(raw, serverOptions);
  const outcome = outcomeOfWrite(socket, chunk);
  raw.connect((server.address() as AddressInfo).port, "127.0.0.1");
  await outcome;
  raw.destroy();
  server.close();
  return outcome;
}

console.log(
  JSON.stringify({
    aboveAsBuffer: await afterTheHandshake(above),
    aboveAsString: await afterTheHandshake(rope(2 ** 30), "utf16le"),
    aboveBeforeTheTransportConnects: await beforeTheTransportConnects(above),
    atTheLimit: await onItsClosedHandle((await connectedClient()).client, above.subarray(0, limit)),
    aboveOnATCPSocket: await onItsClosedHandle(await connectedTCPSocket(), above),
  }),
);
process.exit(0);
