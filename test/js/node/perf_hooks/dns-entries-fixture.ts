// Fixture for perf_hooks.test.ts ("node:dns operations are observable ...").
// A local UDP DNS server answers every A/TXT query so the 'dns' performance
// entries asserted by the parent test are produced without a real resolver.
// Runs in its own process because it repoints the default resolver at the
// local server with dns.setServers().
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import { PerformanceObserver } from "node:perf_hooks";

function readName(message: Buffer, offset: number) {
  const labels: string[] = [];
  while (message[offset] !== 0) {
    labels.push(message.subarray(offset + 1, offset + 1 + message[offset]).toString("ascii"));
    offset += 1 + message[offset];
  }
  return { name: labels.join("."), end: offset + 1 };
}

// One resource record per supported QTYPE, each using the 0xc00c compression
// pointer back to the question name at offset 12.
const A_RECORD = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]);
const TXT_RECORD = Buffer.from([0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60, 0, 6, 5, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);

// Echo the question and append one record of the requested type. Names under
// "nx." are answered with RCODE=3 (NXDOMAIN) so the query fails.
function respond(query: Buffer): Buffer {
  const { name, end } = readName(query, 12);
  const qtype = query.readUInt16BE(end);
  const notFound = name.startsWith("nx.");
  const answer = notFound ? undefined : qtype === 1 ? A_RECORD : qtype === 16 ? TXT_RECORD : undefined;
  const header = Buffer.alloc(12);
  header[0] = query[0];
  header[1] = query[1];
  header[2] = 0x81; // QR=1 RD=1
  header[3] = notFound ? 0x83 : 0x80; // RA=1, RCODE
  header[5] = 1; // QDCOUNT
  header[7] = answer ? 1 : 0; // ANCOUNT
  const question = query.subarray(12, end + 4);
  return answer ? Buffer.concat([header, question, answer]) : Buffer.concat([header, question]);
}

const server = dgram.createSocket("udp4");
server.on("message", (message, rinfo) => server.send(respond(message), rinfo.port, rinfo.address));
server.bind(0, "127.0.0.1");
await once(server, "listening");
const nameserver = `127.0.0.1:${(server.address() as { port: number }).port}`;
dns.setServers([nameserver]);

const entries: unknown[] = [];
const observer = new PerformanceObserver(list => {
  entries.push(...list.getEntries());
});
// "resource" is accepted but never delivered; only the "dns" entries arrive.
observer.observe({ entryTypes: ["dns", "resource"] });

// Each operation is awaited so the entries are recorded in a fixed order.
await new Promise((resolve, reject) => dns.lookup("localhost", error => (error ? reject(error) : resolve(undefined))));
await dns.promises.lookup("localhost");
await new Promise((resolve, reject) =>
  dns.lookupService("127.0.0.1", 80, error => (error ? reject(error) : resolve(undefined))),
);
await dns.promises.lookupService("127.0.0.1", 80);
await new Promise((resolve, reject) => dns.resolve4("a.test", error => (error ? reject(error) : resolve(undefined))));
await dns.promises.resolve4("a.test");
await dns.promises.resolve4("a.test", { ttl: true });
await new Promise((resolve, reject) =>
  dns.resolve("a.test", "TXT", error => (error ? reject(error) : resolve(undefined))),
);
await dns.promises.resolve("a.test", "TXT");
const resolver = new dns.Resolver();
resolver.setServers([nameserver]);
await new Promise((resolve, reject) =>
  resolver.resolveTxt("a.test", error => (error ? reject(error) : resolve(undefined))),
);
const promisesResolver = new dns.promises.Resolver();
promisesResolver.setServers([nameserver]);
await promisesResolver.resolveTxt("a.test");

// Neither of these may record an entry: an IP-literal lookup never reaches
// the resolver, and a failed query is skipped, both matching Node.
await new Promise(resolve => dns.lookup("127.0.0.1", resolve));
const notFoundError = await dns.promises.resolve4("nx.test").then(
  () => null,
  error => error,
);
if (!notFoundError) throw new Error("nx.test unexpectedly resolved");

// Entries are handed to observers on a setImmediate scheduled by the
// operation that produced them, so one turn after the last awaited operation
// every pending delivery has run.
await new Promise(resolve => setImmediate(resolve));

// Nothing recorded after disconnect() may be delivered.
observer.disconnect();
await dns.promises.resolveTxt("a.test");
await new Promise(resolve => setImmediate(resolve));

server.close();
console.log(JSON.stringify(entries));
