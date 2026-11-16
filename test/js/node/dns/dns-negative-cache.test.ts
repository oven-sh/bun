import { expect, test } from "bun:test";
import dns from "node:dns";
import dgram from "node:dgram";
import { once } from "node:events";

test("dns.Resolver re-queries after a NODATA response", async () => {
  const socket = dgram.createSocket("udp4");
  const hostname = "_challenge.app.example.test";
  const uint16 = (n: number) => [(n >> 8) & 255, n & 255];
  const uint32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const dnsName = (name: string) => [...name.split(".").flatMap(label => [label.length, ...Buffer.from(label)]), 0];

  let recordExists = false;
  let queries = 0;
  socket.on("message", (request, peer) => {
    queries++;
    let questionEnd = 12;
    while (request[questionEnd] !== 0) questionEnd += request[questionEnd] + 1;
    questionEnd += 5;

    // NODATA with a five-second SOA TTL is a valid negative DNS answer.
    const soaData = [
      ...dnsName("ns1.example.test"),
      ...dnsName("hostmaster.example.test"),
      ...uint32(1),
      ...uint32(3600),
      ...uint32(300),
      ...uint32(2419200),
      ...uint32(5),
    ];
    const soa = [
      ...dnsName("example.test"),
      ...uint16(6),
      ...uint16(1),
      ...uint32(5),
      ...uint16(soaData.length),
      ...soaData,
    ];
    const txtData = [5, ...Buffer.from("token")];
    const txt = [0xc0, 0x0c, ...uint16(16), ...uint16(1), ...uint32(5), ...uint16(txtData.length), ...txtData];
    const header = [
      request[0],
      request[1],
      0x84,
      0x00,
      ...uint16(1),
      ...uint16(recordExists ? 1 : 0),
      ...uint16(recordExists ? 0 : 1),
      ...uint16(0),
    ];
    socket.send(
      Buffer.from([...header, ...request.subarray(12, questionEnd), ...(recordExists ? txt : soa)]),
      peer.port,
      peer.address,
    );
  });

  try {
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const resolver = new dns.promises.Resolver({ tries: 1, timeout: 1000 });
    resolver.setServers(["127.0.0.1:" + socket.address().port]);

    expect(
      await resolver.resolveTxt(hostname).then(
        () => "found",
        () => "absent",
      ),
    ).toBe("absent");
    expect(queries).toBe(1);

    recordExists = true;
    expect(await resolver.resolveTxt(hostname)).toEqual([["token"]]);
    expect(queries).toBe(2);

    // Node also re-queries positive responses rather than caching them.
    expect(await resolver.resolveTxt(hostname)).toEqual([["token"]]);
    expect(queries).toBe(3);
  } finally {
    socket.close();
  }
});
