// Looks up each [name, options] of the JSON in argv with the "c-ares" backend, which asks a local server for a small zone.
// Prints what each lookup gave and the questions it took.
import dns from "node:dns";
import { a, aaaa, cname, dnsServer, name, RCODE, record, TYPE, u32 } from "../../node/dns/dns-server";

const mixed = [a("mixed.test", 60, "10.0.0.7"), aaaa("mixed.test", 60, "20010db8000000000000000000000007")];
/** `null`: no answer. */
const zone: Record<string, Record<number, Buffer[] | null>> = {
  "host.corp.test": {
    [TYPE.A]: [a("host.corp.test", 60, "10.0.0.1")],
    [TYPE.AAAA]: [aaaa("host.corp.test", 60, "20010db8000000000000000000000001")],
  },
  "host.other.test": { [TYPE.A]: [a("host.other.test", 60, "10.0.0.2")] },
  "v6.test": { [TYPE.AAAA]: [aaaa("v6.test", 60, "20010db8000000000000000000000006")] },
  "alias.test": {
    [TYPE.A]: [cname("alias.test", 60, "real.test"), a("real.test", 30, "10.0.0.4"), a("real.test", 30, "10.0.0.5")],
    [TYPE.AAAA]: [cname("alias.test", 60, "real.test")],
  },
  "mixed.test": { [TYPE.A]: mixed, [TYPE.AAAA]: mixed },
  "silent": { [TYPE.A]: [a("silent", 0, "10.0.0.8")], [TYPE.AAAA]: null },
};
const soa = record(
  "corp.test",
  TYPE.SOA,
  300,
  Buffer.concat([name("ns.corp.test"), name("admin.corp.test"), u32(1, 2, 3, 4, 300)]),
);

await using server = await dnsServer(query => {
  if (query.name === "silent.corp.test") return { rcode: RCODE.NXDOMAIN, authority: [soa] };
  const records = zone[query.name.toLowerCase()];
  if (records?.[query.type] === null) return undefined;
  return records ? { answers: records[query.type] ?? [] } : { rcode: RCODE.NXDOMAIN };
});
dns.setServers([server.address]);

const results: unknown[] = [];
for (const [name, options] of JSON.parse(process.argv[2])) {
  const before = server.queries.length;
  const result = await Bun.dns.lookup(name, { backend: "c-ares", ...options }).then(
    addresses => addresses.map(({ address, family }) => `${address} ${family}`).sort(),
    error => error.code,
  );
  results.push([name, result, server.queries.slice(before).map(query => `${query.name} ${query.type}`)]);
}
console.log(JSON.stringify(results));
