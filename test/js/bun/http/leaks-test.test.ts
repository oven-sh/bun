import { expect, test } from "bun:test";
import { isASAN } from "harness";
import { join } from "path";

// This test was never leaking, as far as i can tell.
test("request error doesn't leak", async () => {
  expect([join(import.meta.dir, "request-constructor-leak-fixture.js")]).toRun();
});

test("response error doesn't leak", async () => {
  expect([join(import.meta.dir, "response-constructor-leak-fixture.js")]).toRun();
});

// Under ASAN the system allocator's quarantine retains ~256 MB of freed URL
// buffers, which is indistinguishable from the ~256 MB pre-fix leak signature
// at the fixture's 8192-iteration workload. Skip rather than widen the
// threshold past the signal; the non-ASAN tier still runs with the 64 MB
// threshold, which catches a real leak (~324 MB).
test.skipIf(isASAN)("server.fetch(string) doesn't leak the URL buffer", async () => {
  expect([join(import.meta.dir, "server-fetch-string-leak-fixture.js")]).toRun();
});
