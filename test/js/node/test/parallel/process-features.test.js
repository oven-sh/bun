//#FILE: test-process-features.js
//#SHA1: 18e2385d3d69890cd826120906ce495a0bc4ba85
//-----------------
"use strict";

test("process.features", () => {
  const keys = new Set(Object.keys(process.features));

  expect(keys).toEqual(
    new Set(["inspector", "debug", "uv", "ipv6", "tls_alpn", "tls_sni", "tls_ocsp", "tls", "cached_builtins"]),
  );

  for (const key of keys) {
    expect(typeof process.features[key]).toBe("boolean");
  }
});

//<#END_FILE: test-process-features.js
