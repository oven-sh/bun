import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26579
// When using fetch with an HTTPS URL and a custom Host header different from the URL's hostname,
// Bun was incorrectly using the Host header value for TLS SNI instead of the URL's hostname.
// This caused ConnectionRefused errors because the server received a TLS ClientHello with
// an incorrect SNI value.

test("fetch with custom Host header should use URL hostname for TLS SNI", async () => {
  // This should succeed - the TLS SNI should use "httpbin.org" (the URL hostname),
  // not "custom-host.example" (the Host header value).
  // Before the fix, this would throw ConnectionRefused or ERR_TLS_CERT_ALTNAME_INVALID
  // because the TLS handshake used the wrong SNI.
  const response = await fetch("https://httpbin.org/headers", {
    headers: new Headers({ host: "custom-host.example" }),
  });

  expect(response.ok).toBe(true);
  const json = (await response.json()) as { headers: { Host: string } };
  // Verify the custom Host header was actually sent to the server
  expect(json.headers.Host).toBe("custom-host.example");
});

test("fetch with mismatched Host header - object syntax", async () => {
  // Test with object syntax for headers instead of Headers instance
  const response = await fetch("https://httpbin.org/headers", {
    headers: { host: "another-custom-host.example" },
  });

  expect(response.ok).toBe(true);
  const json = (await response.json()) as { headers: { Host: string } };
  expect(json.headers.Host).toBe("another-custom-host.example");
});

test("fetch without custom Host header still works", async () => {
  // Sanity check - normal fetch should still work
  const response = await fetch("https://httpbin.org/headers");
  expect(response.ok).toBe(true);
  const json = (await response.json()) as { headers: { Host: string } };
  // Without a custom Host header, httpbin should receive "httpbin.org"
  expect(json.headers.Host).toBe("httpbin.org");
});
