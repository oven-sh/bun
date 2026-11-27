import { dns as bun_dns } from "bun";
import * as dns from "node:dns";
import { expectType } from "./utilities";

dns.resolve("asdf", "A", () => {});
dns.reverse("asdf", () => {});
dns.getServers();

expectType(Bun.dns.getCacheStats()).is<{
  cacheHitsCompleted: number;
  cacheHitsInflight: number;
  cacheMisses: number;
  size: number;
  errors: number;
  totalCount: number;
}>();

expectType(Bun.dns.V4MAPPED).is<number>();
expectType(bun_dns.prefetch("bun.sh")).is<void>();

expectType(bun_dns.resolve("bun.sh")).is<Promise<dns.RecordWithTtl[]>>();
expectType(bun_dns.resolve("bun.sh", "AAAA")).is<Promise<dns.RecordWithTtl[]>>();
expectType(bun_dns.resolve("bun.sh", "SOA")).is<Promise<dns.SoaRecord>>();
expectType(bun_dns.resolve("bun.sh", "TXT")).is<Promise<string[][]>>();
// @ts-expect-error
bun_dns.resolve("bun.sh", "BOGUS");
expectType(bun_dns.resolveCaa("bun.sh")).is<Promise<dns.CaaRecord[]>>();
expectType(bun_dns.resolveCname("bun.sh")).is<Promise<string[]>>();
expectType(bun_dns.resolveMx("bun.sh")).is<Promise<dns.MxRecord[]>>();
expectType(bun_dns.resolveNaptr("bun.sh")).is<Promise<dns.NaptrRecord[]>>();
expectType(bun_dns.resolveNs("bun.sh")).is<Promise<string[]>>();
expectType(bun_dns.resolvePtr("bun.sh")).is<Promise<string[]>>();
expectType(bun_dns.resolveSoa("bun.sh")).is<Promise<dns.SoaRecord>>();
expectType(bun_dns.resolveSrv("bun.sh")).is<Promise<dns.SrvRecord[]>>();
expectType(bun_dns.resolveTlsa("bun.sh")).is<Promise<Bun.dns.TlsaRecord[]>>();
expectType(bun_dns.resolveTxt("bun.sh")).is<Promise<string[][]>>();
expectType(bun_dns.reverse("127.0.0.1")).is<Promise<string[]>>();
expectType(bun_dns.lookupService("127.0.0.1", 22)).is<Promise<[string, string | undefined]>>();
expectType(bun_dns.getServers()).is<string[]>();
expectType(
  bun_dns.setServers([
    [4, "127.0.0.1"],
    [6, "::1", 5353],
  ]),
).is<void>();

for (const record of await bun_dns.resolveAny("bun.sh")) {
  if (record.type === "TLSA") expectType(record.data).is<ArrayBuffer>();
  if (record.type === "MX") expectType(record.exchange).is<string>();
}
