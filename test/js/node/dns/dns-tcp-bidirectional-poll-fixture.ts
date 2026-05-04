// Local UDP DNS server that answers every query with TC=1 (truncated) so
// c-ares retries over TCP on the same port, plus a TCP DNS server that
// returns a single TXT "hello" record. The Resolver query then exercises
// FilePoll with both .poll_readable and .poll_writable set on one fd.
import dgram from "node:dgram";
import net from "node:net";
import { once } from "node:events";
import { Resolver } from "node:dns";

// Build a DNS response that echoes the question section from `query`.
function buildResponse(query: Buffer, flagsHi: number, flagsLo: number, answer?: Buffer): Buffer {
  // Walk labels from offset 12 until the zero-length root label, then
  // QTYPE(2) + QCLASS(2).
  let off = 12;
  while (off < query.length && query[off] !== 0) off += query[off] + 1;
  off += 1 + 2 + 2;
  const question = query.subarray(12, off);

  const header = Buffer.alloc(12);
  header[0] = query[0];
  header[1] = query[1];
  header[2] = flagsHi;
  header[3] = flagsLo;
  header[5] = 1; // QDCOUNT
  header[7] = answer ? 1 : 0; // ANCOUNT

  return answer ? Buffer.concat([header, question, answer]) : Buffer.concat([header, question]);
}

// A single TXT RR "hello" using the 0xc00c compression pointer back to the
// question name at offset 12.
const txtAnswer = Buffer.from([
  0xc0, 0x0c, // NAME
  0x00, 0x10, // TYPE = TXT
  0x00, 0x01, // CLASS = IN
  0x00, 0x00, 0x00, 0x3c, // TTL = 60
  0x00, 0x06, // RDLENGTH
  0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f, // <5>"hello"
]);

const udp = dgram.createSocket("udp4");
udp.on("message", (msg, rinfo) => {
  // QR=1 Opcode=0 AA=0 TC=1 RD=1 | RA=1 Z=0 RCODE=0
  udp.send(buildResponse(msg, 0x83, 0x80), rinfo.port, rinfo.address);
});
udp.bind(0, "127.0.0.1");
await once(udp, "listening");
const port = (udp.address() as dgram.AddressInfo).port;

// DNS-over-TCP frames are prefixed with a 2-byte big-endian length.
const tcp = net.createServer(socket => {
  let buf = Buffer.alloc(0);
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const len = buf.readUInt16BE(0);
      if (buf.length < 2 + len) break;
      const query = buf.subarray(2, 2 + len);
      buf = buf.subarray(2 + len);
      // QR=1 RD=1 | RA=1
      const resp = buildResponse(query, 0x81, 0x80, txtAnswer);
      const framed = Buffer.alloc(2 + resp.length);
      framed.writeUInt16BE(resp.length, 0);
      resp.copy(framed, 2);
      socket.write(framed);
    }
  });
  socket.on("error", () => {});
});
await new Promise<void>((resolve, reject) => {
  tcp.on("error", reject);
  tcp.listen(port, "127.0.0.1", resolve);
});

const r = new Resolver({ timeout: 1000, tries: 1 });
r.setServers(["127.0.0.1:" + port]);
r.resolveTxt("example.test", (err, records) => {
  tcp.close();
  udp.close();
  if (err) {
    console.error("resolve error:", (err as NodeJS.ErrnoException).code || err.message);
    process.exit(1);
  }
  console.log(JSON.stringify(records));
  process.exit(0);
});
