// Looks up each [name, options] of the JSON in argv with the "c-ares" backend, which asks a local server for a small zone.
// Prints what each lookup gave and the questions it took.
import dns from "node:dns";
import { a, aaaa, cname, distinctQuestions, dnsServer, RCODE, TYPE } from "../../node/dns/dns-server";

const mixed = [a("mixed.test", 60, "10.0.0.7"), aaaa("mixed.test", 60, "20010db8000000000000000000000007")];
const zone: Record<string, Record<number, Buffer[]>> = {
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
};

await using server = await dnsServer(query => {
  const records = zone[query.name.toLowerCase()];
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
  results.push([name, result, distinctQuestions(server.queries.slice(before))]);
}
console.log(JSON.stringify(results));
