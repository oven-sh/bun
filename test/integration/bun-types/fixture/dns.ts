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

expectType(Bun.dns.ADDRCONFIG).is<number>();
expectType(Bun.dns.ALL).is<number>();
expectType(Bun.dns.V4MAPPED).is<number>();
expectType(Bun.dns.lookup("example.com")).is<Promise<Bun.DNSLookup[]>>();
expectType(bun_dns.prefetch("bun.sh")).is<void>();

// resolve() overloads per record type
expectType(Bun.dns.resolve("example.com")).is<Promise<Bun.dns.AddressRecord[]>>();
expectType(Bun.dns.resolve("example.com", "A")).is<Promise<Bun.dns.AddressRecord[]>>();
expectType(Bun.dns.resolve("example.com", "aaaa")).is<Promise<Bun.dns.AddressRecord[]>>();
expectType(Bun.dns.resolve("example.com", "CNAME")).is<Promise<string[]>>();
expectType(Bun.dns.resolve("example.com", "NS")).is<Promise<string[]>>();
expectType(Bun.dns.resolve("example.com", "PTR")).is<Promise<string[]>>();
expectType(Bun.dns.resolve("example.com", "TXT")).is<Promise<string[][]>>();
expectType(Bun.dns.resolve("example.com", "MX")).is<Promise<dns.MxRecord[]>>();
expectType(Bun.dns.resolve("example.com", "SRV")).is<Promise<dns.SrvRecord[]>>();
expectType(Bun.dns.resolve("example.com", "SOA")).is<Promise<dns.SoaRecord>>();
expectType(Bun.dns.resolve("example.com", "CAA")).is<Promise<dns.CaaRecord[]>>();
expectType(Bun.dns.resolve("example.com", "ANY")).is<Promise<dns.AnyRecord[]>>();
// The runtime's resolve() rejects NAPTR (ERR_INVALID_ARG_VALUE); only resolveNaptr serves it.
// @ts-expect-error
Bun.dns.resolve("example.com", "NAPTR");

// resolve* family
expectType(Bun.dns.resolveSrv("example.com")).is<Promise<dns.SrvRecord[]>>();
expectType(Bun.dns.resolveTxt("example.com")).is<Promise<string[][]>>();
expectType(Bun.dns.resolveSoa("example.com")).is<Promise<dns.SoaRecord>>();
expectType(Bun.dns.resolveNaptr("example.com")).is<Promise<dns.NaptrRecord[]>>();
expectType(Bun.dns.resolveMx("example.com")).is<Promise<dns.MxRecord[]>>();
expectType(Bun.dns.resolveCaa("example.com")).is<Promise<dns.CaaRecord[]>>();
expectType(Bun.dns.resolveNs("example.com")).is<Promise<string[]>>();
expectType(Bun.dns.resolvePtr("example.com")).is<Promise<string[]>>();
expectType(Bun.dns.resolveCname("example.com")).is<Promise<string[]>>();
expectType(Bun.dns.resolveAny("example.com")).is<Promise<dns.AnyRecord[]>>();

// servers, reverse, lookupService
expectType(Bun.dns.getServers()).is<string[]>();
expectType(
  Bun.dns.setServers([
    [4, "8.8.8.8", 53],
    [6, "2606:4700:4700::1111", 53],
  ]),
).is<void>();
expectType(bun_dns.reverse("8.8.8.8")).is<Promise<string[]>>();
expectType(bun_dns.lookupService("127.0.0.1", 22)).is<Promise<[hostname: string, service: string]>>();
