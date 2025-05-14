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
