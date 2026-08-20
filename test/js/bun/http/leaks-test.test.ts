import { expect, test } from "bun:test";
import { bunRun } from "harness";
import { join } from "path";

// This test was never leaking, as far as i can tell.
test.concurrent("request error doesn't leak", async () => {
  const result = await bunRun(join(import.meta.dir, "request-constructor-leak-fixture.js"));
  expect(result.stdout).toMatch(/^RSS: \d+ MB$/);
  expect(result).toSpawn();
});

test.concurrent("response error doesn't leak", async () => {
  const result = await bunRun(join(import.meta.dir, "response-constructor-leak-fixture.js"));
  expect(result.stdout).toMatch(/^RSS: \d+ MB$/);
  expect(result).toSpawn();
});

test.concurrent(
  "server.fetch(string) doesn't leak the URL buffer",
  async () => {
    const result = await bunRun(join(import.meta.dir, "server-fetch-string-leak-fixture.js"));
    expect(result.stdout).toMatch(/^RSS delta: -?\d+(\.\d+)? MB$/);
    expect(result).toSpawn();
  },
  // Under debug-ASAN the fixture runs 4096*2 server.fetch() calls to clear the
  // ASAN quarantine ceiling; that legitimately exceeds the 5s default.
  30_000,
);
