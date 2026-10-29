// Bun.serve, a node:quic client, and a UDP relay between them, for "Bun.serve HTTP/3 responses behind a 100 Continue
// arrive when the client's SETTINGS come with the request's content". The relay changes the order of the client's
// packets: the server gets the request first, and the client's SETTINGS together with the request's content. This
// is its own process so that a server that never answers cannot hold the test file.
//
// Environment: TLS, the `tls` option of Bun.serve as JSON.
//
// Prints what the client got: {"seen": ["info 100", "headers 200"], "body": "content:800"}.
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { connect, type SessionOptions } from "node:quic";

// Both sizes are more than any packet that the client sends for another reason, so the relay can tell the packet of
// the request and the packet of its content from the rest. Huffman coding doesn't shorten these bytes.
const requestField = Buffer.alloc(600, "~").toString();
const content = Buffer.alloc(800, "c");

const server = Bun.serve({
  port: 0,
  tls: JSON.parse(process.env.TLS!),
  http3: true,
  http1: false,
  // The content and its end arrive together, so this answers in the pass that read them.
  fetch: async request => new Response(`content:${(await request.arrayBuffer()).byteLength}`),
});

// A datagram can hold several QUIC packets. This returns where its packets with a long header end: those are the
// packets of the handshake. A packet with a short header follows them, and it carries the streams of HTTP/3.
function endOfTheHandshakePackets(datagram: Buffer) {
  let at = 0;
  while (at < datagram.length && datagram[at] & 0x80) {
    // QUIC version 2 (RFC 9369) gave the packet types other numbers.
    const initial = datagram.readUInt32BE(at + 1) === 0x6b3343cf ? 0x10 : 0x00;
    // The flags and the version, then the two connection IDs with their lengths.
    let p = at + 5;
    p += 1 + datagram[p];
    p += 1 + datagram[p];
    const varint = () => {
      const size = 1 << (datagram[p] >> 6);
      let value = datagram[p] & 0x3f;
      for (let i = 1; i < size; i++) value = value * 256 + datagram[p + i];
      p += size;
      return value;
    };
    // Only an Initial packet has a token.
    if ((datagram[at] & 0x30) === initial) {
      const tokenLength = varint();
      p += tokenLength;
    }
    const length = varint();
    at = p + length;
  }
  return Math.min(at, datagram.length);
}

// The relay. The client talks to `front`, and `upstream` is the client as the server sees it.
const front = createSocket("udp4");
const upstream = createSocket("udp4");
front.bind(0, "127.0.0.1");
upstream.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(upstream, "listening")]);
let clientPort = 0;
// The client's packets with a short header wait here.
const held: Buffer[] = [];
let holding = true;
const toServer = (packet: Buffer) => upstream.send(packet, server.port!, "127.0.0.1");
upstream.on("message", packet => front.send(packet, clientPort, "127.0.0.1"));
front.on("message", (datagram, from) => {
  clientPort = from.port;
  const end = endOfTheHandshakePackets(datagram);
  // The first byte of a packet with a short header has this bit. Zero bytes are padding.
  if (end === datagram.length || !(datagram[end] & 0x40)) return void toServer(datagram);
  if (end > 0) toServer(datagram.subarray(0, end));
  const packet = Buffer.from(datagram.subarray(end));
  if (holding) held.push(packet);
  else toServer(packet);
});
// Waits for a packet of at least `size` bytes among those that the relay got after the first `after`.
async function heldPacket(size: number, after = 0) {
  for (;;) {
    const at = held.findIndex((packet, i) => i >= after && packet.length >= size);
    if (at !== -1) return at;
    if (client.destroyed) return -1;
    await new Promise(resolve => setImmediate(resolve));
  }
}

const client = await connect(`127.0.0.1:${front.address().port}`, {
  servername: "localhost",
  verifyPeer: "manual",
  transportParams: { maxIdleTimeout: 30 },
  onerror() {},
} as SessionOptions);
client.closed.catch(() => {});
await client.opened;

const seen: string[] = [];
const continued = Promise.withResolvers<void>();
client.closed.then(continued.resolve, continued.resolve);
const stream: any = await client.createBidirectionalStream({
  oninfo(headers: Record<string, string>) {
    seen.push(`info ${headers[":status"]}`);
    continued.resolve();
  },
  onheaders: (headers: Record<string, string>) => void seen.push(`headers ${headers[":status"]}`),
} as any);
stream.closed.catch(() => {});
stream.sendHeaders({
  ":method": "POST",
  ":path": "/",
  ":scheme": "https",
  ":authority": "localhost",
  expect: "100-continue",
  "x-filler": requestField,
});

// The server gets the request, and not the packets in front of it: they have the client's SETTINGS. It answers with
// the 100 Continue, which needs no QPACK encoder stream yet.
const request = await heldPacket(requestField.length);
if (request !== -1) toServer(held.splice(request, 1)[0]);
await continued.promise;

// Now the client sends the content. The server gets the SETTINGS and the content in one pass. lsquic opens its QPACK
// encoder stream for the SETTINGS, and the handler answers in the same pass: the header block of the response has to
// wait for the first bytes of that stream.
const before = held.length;
stream.writer.writeSync(content);
stream.writer.endSync();
await heldPacket(content.byteLength, before);
holding = false;
for (const packet of held.splice(0)) toServer(packet);

let body = "";
const decoder = new TextDecoder();
try {
  for await (const batch of stream) for (const chunk of batch) body += decoder.decode(chunk, { stream: true });
} catch {}
console.log(JSON.stringify({ seen, body }));
process.exit(0);
