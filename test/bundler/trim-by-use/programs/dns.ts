import dgram from "node:dgram";
import dns from "node:dns";

const server = dgram.createSocket("udp4");
server.on("message", (query, from) => {
  let end = 12;
  while (query[end] !== 0) end += query[end]! + 1;
  const question = query.subarray(12, end + 5);
  const header = Buffer.from([query[0]!, query[1]!, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
  const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 1, 2, 3]);
  server.send(Buffer.concat([header, question, answer]), from.port, from.address);
});
await new Promise<void>(resolve => server.bind(0, "127.0.0.1", resolve));

const resolver = new dns.promises.Resolver({ tries: 1, timeout: 2000 });
resolver.setServers([`127.0.0.1:${server.address().port}`]);
console.log(resolver.getServers().length, JSON.stringify(await resolver.resolve4("name.example")));
console.log(JSON.stringify(await dns.promises.lookup("127.0.0.1")));
console.log((await Bun.dns.lookup("localhost", { family: 4 })).map(found => found.address).join(","));
console.log(typeof Bun.dns.getCacheStats().size);
server.close();
