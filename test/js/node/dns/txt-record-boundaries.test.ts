import { test, expect } from "bun:test";
import dns from "node:dns";
import dgram from "node:dgram";
import { once } from "node:events";

test("resolveTxt groups character strings by DNS resource record", async () => {
  const server = dgram.createSocket("udp4");

  const txtRecord = (strings: string[]) => {
    const chunks = strings.map(s => {
      const bytes = Buffer.from(s);
      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    });
    const rdata = Buffer.concat(chunks);
    return Buffer.concat([Buffer.from([0xc0, 0x0c, 0x00, 0x10, 0x00, 0x01, 0, 0, 0, 60, 0, rdata.length]), rdata]);
  };
  const answers = [txtRecord(["first", " second"]), txtRecord(["third"])];

  server.on("message", (query, client) => {
    let end = 12;
    while (end < query.length && query[end] !== 0) end += 1 + query[end];
    end += 5; // final zero label and QTYPE/QCLASS
    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2);
    header[2] = 0x81;
    header[3] = 0x80;
    header[5] = 1; // QDCOUNT
    header[7] = answers.length; // ANCOUNT
    server.send(Buffer.concat([header, query.subarray(12, end), ...answers]), client.port, client.address);
  });

  try {
    server.bind(0, "127.0.0.1");
    await once(server, "listening");
    const address = "127.0.0.1:" + server.address().port;
    const resolver = new dns.Resolver({ timeout: 1000, tries: 1 });
    resolver.setServers([address]);
    const callbackResult = await new Promise((resolve, reject) => {
      resolver.resolveTxt("parts.example.test", (err, records) => (err ? reject(err) : resolve(records)));
    });

    const promiseResolver = new dns.promises.Resolver({ timeout: 1000, tries: 1 });
    promiseResolver.setServers([address]);
    const promiseResult = await promiseResolver.resolveTxt("parts.example.test");

    const expected = [["first", " second"], ["third"]];
    expect(callbackResult).toEqual(expected);
    expect(promiseResult).toEqual(expected);
  } finally {
    server.close();
  }
});
