// Mock-DNS server for TLSA records. Runs in a subprocess so the Resolver's
// native backing (freed only at GC finalization) doesn't trip LSan in the
// parent test process. Structured like dns-resolver-concurrent-timeout-fixture.ts.
import dgram from "node:dgram";
import dns from "node:dns";

const certData = Buffer.from("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "hex");

function buildTlsaResponse(query: Buffer): Buffer {
  let off = 12;
  while (query[off] !== 0) off += query[off] + 1;
  off += 1; // root label
  off += 4; // QTYPE + QCLASS
  const question = query.subarray(12, off);

  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // id
  header.writeUInt16BE(0x8180, 2); // standard response, RA
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(1, 6); // ANCOUNT

  const rdata = Buffer.concat([Buffer.from([3, 1, 1]), certData]);
  const answer = Buffer.alloc(12 + rdata.length);
  answer.writeUInt16BE(0xc00c, 0); // name: pointer to question name
  answer.writeUInt16BE(52, 2); // TYPE = TLSA
  answer.writeUInt16BE(1, 4); // CLASS = IN
  answer.writeUInt32BE(60, 6); // TTL
  answer.writeUInt16BE(rdata.length, 10); // RDLENGTH
  rdata.copy(answer, 12);

  return Buffer.concat([header, question, answer]);
}

function normalize(records: any[]) {
  return records.map(r => ({
    ...r,
    data: r.data instanceof ArrayBuffer ? Buffer.from(r.data).toString("hex") : r.data,
    dataIsArrayBuffer: r.data instanceof ArrayBuffer,
  }));
}

const server = dgram.createSocket("udp4");
server.on("message", (msg, rinfo) => {
  server.send(buildTlsaResponse(msg), rinfo.port, rinfo.address);
});
server.on("error", err => {
  console.error(err);
  process.exit(1);
});

server.bind(0, "127.0.0.1", () => {
  const resolver = new dns.promises.Resolver();
  resolver.setServers([`127.0.0.1:${(server.address() as dgram.AddressInfo).port}`]);

  Promise.all([
    resolver.resolveTlsa("_443._tcp.example.org"),
    resolver.resolve("_443._tcp.example.org", "TLSA"),
    resolver.resolveAny("_443._tcp.example.org"),
  ]).then(
    ([byMethod, byRrtype, any]) => {
      console.log(
        JSON.stringify({
          byMethod: normalize(byMethod),
          byRrtype: normalize(byRrtype),
          byAny: normalize(any.filter((r: any) => r.type === "TLSA")),
        }),
      );
      resolver.cancel();
      server.close();
    },
    err => {
      console.error(err);
      resolver.cancel();
      server.close();
      process.exit(1);
    },
  );
});
