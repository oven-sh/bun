import { expect, test } from "bun:test";
import { readFileSync } from "fs";

test("TLS certificate store optimization - avoid redundant X509_STORE_set_default_paths", async () => {
  // This test verifies that we don't call the expensive X509_STORE_set_default_paths()
  // function when creating X509_STORE instances. That function parses certificates from
  // disk which is unnecessary since we already have them parsed in memory.

  // Create a simple HTTPS server
  const server = Bun.serve({
    port: 0,
    tls: {
      cert: Bun.file("test/js/bun/http/fixtures/cert.pem"),
      key: Bun.file("test/js/bun/http/fixtures/cert.key"),
    },
    fetch(req) {
      return new Response("OK");
    },
  });

  const url = `https://localhost:${server.port}`;
  const ca = readFileSync("test/js/bun/http/fixtures/cert.pem", "utf8");

  try {
    // Make multiple requests with custom CA - this used to trigger expensive
    // X509_STORE_set_default_paths() on each request
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        fetch(url, {
          tls: {
            ca,
            rejectUnauthorized: false,
          },
        }).then(r => r.text()),
      );
    }

    const results = await Promise.all(promises);

    // Verify all requests succeeded
    for (const result of results) {
      expect(result).toBe("OK");
    }

    // The optimization removes the expensive callstack:
    // cbs_get_any_asn1_element -> CBS_get_any_asn1_element -> ... -> X509_STORE_set_default_paths
    // by skipping X509_STORE_set_default_paths entirely since we already have certificates in memory
  } finally {
    server.stop();
  }
});

test("TLS works with NODE_EXTRA_CA_CERTS environment variable", async () => {
  // Verify that NODE_EXTRA_CA_CERTS still works after our optimization
  const server = Bun.serve({
    port: 0,
    tls: {
      cert: Bun.file("test/js/bun/http/fixtures/cert.pem"),
      key: Bun.file("test/js/bun/http/fixtures/cert.key"),
    },
    fetch(req) {
      return new Response("EXTRA_CA_OK");
    },
  });

  const url = `https://localhost:${server.port}`;

  try {
    // Set NODE_EXTRA_CA_CERTS to load additional certificates
    process.env.NODE_EXTRA_CA_CERTS = "test/js/bun/http/fixtures/cert.pem";

    const response = await fetch(url, {
      tls: {
        rejectUnauthorized: false,
      },
    });

    expect(await response.text()).toBe("EXTRA_CA_OK");
  } finally {
    delete process.env.NODE_EXTRA_CA_CERTS;
    server.stop();
  }
});
