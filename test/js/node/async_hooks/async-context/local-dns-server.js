// Shared by the dns.resolve*/dns.reverse fixtures. Not a fixture itself: the
// test file only runs async-context-*.js.
//
// A UDP DNS server on 127.0.0.1 that answers every question with one record of
// the type asked for, so the fixtures never depend on a real resolver or on the
// network. Runs under both node and bun.
const dgram = require("dgram");

function encodeName(name) {
  const parts = [];
  for (const label of name.split(".")) {
    parts.push(Buffer.from([label.length]), Buffer.from(label));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function encodeText(text) {
  return Buffer.concat([Buffer.from([text.length]), Buffer.from(text)]);
}

const rdataByType = {
  5: encodeName("canonical.example"), // CNAME
  12: encodeName("host.example"), // PTR
  15: Buffer.concat([Buffer.from([0, 10]), encodeName("mail.example")]), // MX: preference, exchange
  16: encodeText("async-context"), // TXT
};

function buildResponse(query) {
  // 12-byte header, then the question: QNAME (length-prefixed labels ending in
  // a 0 byte), QTYPE, QCLASS.
  let offset = 12;
  while (offset < query.length && query[offset] !== 0) offset += query[offset] + 1;
  if (offset + 5 > query.length) return null;
  const question = query.subarray(12, offset + 5);
  const qtype = query.readUInt16BE(offset + 1);
  const rdata = rdataByType[qtype];

  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // ID
  header.writeUInt16BE(rdata ? 0x8180 : 0x8183, 2); // QR | RD | RA, rcode NOERROR or NXDOMAIN
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(rdata ? 1 : 0, 6); // ANCOUNT
  if (!rdata) return Buffer.concat([header, question]);

  const answer = Buffer.alloc(12);
  answer.writeUInt16BE(0xc00c, 0); // NAME: pointer to the question name
  answer.writeUInt16BE(qtype, 2);
  answer.writeUInt16BE(1, 4); // CLASS IN
  answer.writeUInt32BE(60, 6); // TTL
  answer.writeUInt16BE(rdata.length, 10);
  return Buffer.concat([header, question, answer, rdata]);
}

// Calls back with the bound server and its "ip:port" for dns.setServers().
function startLocalDnsServer(callback) {
  const server = dgram.createSocket("udp4");
  server.on("message", (query, rinfo) => {
    const response = buildResponse(query);
    if (response) server.send(response, rinfo.port, rinfo.address);
  });
  server.bind(0, "127.0.0.1", () => {
    callback(server, `127.0.0.1:${server.address().port}`);
  });
}

module.exports = { startLocalDnsServer };
