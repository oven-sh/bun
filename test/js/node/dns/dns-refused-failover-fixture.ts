// Minimal DNS-over-UDP servers for exercising nameserver failover.
// argv[2]: "failover" (REFUSED server first, answering server second) or
// "all-refused" (every server answers REFUSED).
import dgram from "node:dgram";
import dns from "node:dns";

// header(12) + name labels + 0 + qtype(2) + qclass(2)
function questionEnd(msg: Buffer): number {
  let off = 12;
  while (msg[off] !== 0) off += msg[off]! + 1;
  return off + 5;
}

function header(msg: Buffer, rcode: number, ancount: number): Buffer {
  const h = Buffer.alloc(12);
  msg.copy(h, 0, 0, 2); // id
  h[2] = 0x81; // QR=1, RD=1
  h[3] = 0x80 | rcode; // RA=1
  h.writeUInt16BE(1, 4); // qdcount
  h.writeUInt16BE(ancount, 6);
  return h;
}

function listen(reply: (msg: Buffer) => Buffer): Promise<dgram.Socket> {
  return new Promise(resolve => {
    const sock = dgram.createSocket("udp4");
    sock.on("message", (msg, rinfo) => sock.send(reply(msg), rinfo.port, rinfo.address));
    sock.bind(0, "127.0.0.1", () => resolve(sock));
  });
}

const refused = (msg: Buffer) => Buffer.concat([header(msg, 5, 0), msg.subarray(12, questionEnd(msg))]);

const answering = (msg: Buffer) => {
  const question = msg.subarray(12, questionEnd(msg));
  const qtype = question.readUInt16BE(question.length - 4);
  if (qtype !== 1) return Buffer.concat([header(msg, 0, 0), question]); // NOERROR, no data
  const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 42]);
  return Buffer.concat([header(msg, 0, 1), question, answer]);
};

const handlers = process.argv[2] === "all-refused" ? [refused, refused] : [refused, answering];
const sockets = await Promise.all(handlers.map(listen));
dns.setServers(sockets.map(s => `127.0.0.1:${s.address().port}`));

try {
  console.log(JSON.stringify({ addresses: await dns.promises.resolve4("failover.example") }));
} catch (e: any) {
  console.log(JSON.stringify({ code: e.code }));
} finally {
  for (const s of sockets) s.close();
}
