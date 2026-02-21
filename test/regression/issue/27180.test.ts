// https://github.com/oven-sh/bun/issues/27180
// c-ares v1.34.6 introduced a regression on Windows where DNS SRV queries fail
// with ECONNREFUSED due to a bug in wide string handling in the Windows registry
// reading code (size == 1 instead of size == sizeof(WCHAR)).
import { expect, test } from "bun:test";
import dns from "node:dns";

test("dns.resolveSrv resolves SRV records", async () => {
  const results = await dns.promises.resolveSrv("_imaps._tcp.gmail.com");
  expect(Array.isArray(results)).toBe(true);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]).toHaveProperty("name");
  expect(results[0]).toHaveProperty("port");
  expect(results[0]).toHaveProperty("priority");
  expect(results[0]).toHaveProperty("weight");
});
