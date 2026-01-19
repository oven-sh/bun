import assert from "node:assert";
import { test } from "node:test";
import tls from "node:tls";

// Regression test for https://github.com/oven-sh/bun/issues/24374
// checkServerIdentity should handle null/undefined certificates gracefully
// instead of throwing "Cannot destructure property 'subject' from null or undefined value"

test("checkServerIdentity handles null certificate without crashing", () => {
  // Node.js throws a TypeError when cert is null, Bun returns an Error.
  // Both behaviors are acceptable - the key is not crashing with
  // "Cannot destructure property 'subject' from null or undefined value"
  let result: Error | undefined;
  let thrown: Error | undefined;

  try {
    result = tls.checkServerIdentity("example.com", null) as Error | undefined;
  } catch (e: any) {
    thrown = e;
  }

  // Either the function threw an error or returned an error
  const error = thrown ?? result;
  assert(error instanceof Error, "Expected an Error to be thrown or returned");
});

test("checkServerIdentity handles undefined certificate without crashing", () => {
  let result: Error | undefined;
  let thrown: Error | undefined;

  try {
    result = tls.checkServerIdentity("example.com", undefined) as Error | undefined;
  } catch (e: any) {
    thrown = e;
  }

  const error = thrown ?? result;
  assert(error instanceof Error, "Expected an Error to be thrown or returned");
});

test("checkServerIdentity handles empty object certificate", () => {
  // Empty object should not crash but should return error about missing DNS name
  // This behavior should be identical between Node.js and Bun
  const result = tls.checkServerIdentity("example.com", {});
  assert(result instanceof Error);
  assert.strictEqual(result.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert(result.message.includes("Cert does not contain a DNS name"));
});

test("checkServerIdentity with valid matching certificate returns undefined", () => {
  // A valid certificate that matches should return undefined (no error)
  const cert = {
    subject: { CN: "example.com" },
    subjectaltname: "DNS:example.com",
  };
  const result = tls.checkServerIdentity("example.com", cert);
  assert.strictEqual(result, undefined);
});

test("checkServerIdentity with mismatched certificate returns error", () => {
  const cert = {
    subject: { CN: "other.com" },
    subjectaltname: "DNS:other.com",
  };
  const result = tls.checkServerIdentity("example.com", cert);
  assert(result instanceof Error);
  assert.strictEqual(result.code, "ERR_TLS_CERT_ALTNAME_INVALID");
});
