import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// Self-signed cert with ONLY DNS:localhost in SANs (no IP SANs).
// Valid from 2025-01-01 to 2035-01-01 to avoid CI clock skew issues.
// This is critical: if the cert also had IP:127.0.0.1, the custom lookup
// tests would pass even without the SNI fix, since BoringSSL would match
// on the IP SAN directly. By excluding IP SANs, we ensure the test only
// passes when the original hostname ("localhost") is correctly preserved
// for TLS SNI and certificate SAN matching.
const localhostOnlyTls = {
  cert: readFileSync(join(import.meta.dir, "27890-localhost-only.crt"), "utf8"),
  key: readFileSync(join(import.meta.dir, "27890-localhost-only.key"), "utf8"),
};

// Uses a local HTTPS server with self-signed certs to avoid CI environments
// lacking system CA certificates (Windows, Alpine).
describe("custom lookup with HTTPS", () => {
  test("https.request with custom lookup should not break TLS", async () => {
    using server = Bun.serve({
      tls: localhostOnlyTls,
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const https = require("https");
const port = ${server.port};
const ca = ${JSON.stringify(localhostOnlyTls.cert)};

function customLookup(hostname, options, callback) {
  // Resolve "localhost" to 127.0.0.1 — simulates the real-world scenario
  // where a custom lookup returns an IP address for a hostname.
  if (options && options.all) {
    callback(null, [{ address: "127.0.0.1", family: 4 }]);
  } else {
    callback(null, "127.0.0.1", 4);
  }
}

const req = https.request("https://localhost:" + port, {
  lookup: customLookup,
  ca,
}, (res) => {
  let data = "";
  res.on("data", (chunk) => data += chunk);
  res.on("end", () => {
    console.log("status:" + res.statusCode + " body:" + data);
  });
});
req.on("error", (e) => {
  console.error("error:" + e.message + " " + (e.code || ""));
  process.exitCode = 1;
});
req.end();
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("certificate");
    expect(stderr).not.toContain("CERT_ALTNAME");
    expect(stdout).toContain("status:200");
    expect(stdout).toContain("body:OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("https.request without custom lookup should still work", async () => {
    using server = Bun.serve({
      tls: localhostOnlyTls,
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const https = require("https");
const port = ${server.port};
const ca = ${JSON.stringify(localhostOnlyTls.cert)};

const req = https.request("https://localhost:" + port, { ca }, (res) => {
  let data = "";
  res.on("data", (chunk) => data += chunk);
  res.on("end", () => {
    console.log("status:" + res.statusCode + " body:" + data);
  });
});
req.on("error", (e) => {
  console.error("error:" + e.message + " " + (e.code || ""));
  process.exitCode = 1;
});
req.end();
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("certificate");
    expect(stdout).toContain("status:200");
    expect(stdout).toContain("body:OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("custom lookup via dns.lookup should preserve hostname for TLS SNI", async () => {
    // This test verifies the specific scenario from issue #27890:
    // A custom lookup that resolves hostname to IP should not break TLS.
    // The lookup uses dns.lookup (which checks /etc/hosts) to resolve
    // "localhost" to an IP, but the original hostname must be preserved
    // for SNI and certificate SAN matching.
    // The cert only has DNS:localhost (no IP SANs), so if SNI is broken
    // and the IP is used for cert verification, it WILL fail.
    using server = Bun.serve({
      tls: localhostOnlyTls,
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const https = require("https");
const dns = require("dns");
const port = ${server.port};
const ca = ${JSON.stringify(localhostOnlyTls.cert)};

// Custom lookup using dns.lookup — exercises the real resolution path
// (including /etc/hosts) where hostname is resolved to IP, reproducing
// the exact issue #27890 scenario. Forces IPv4 to avoid inconsistent
// results on dual-stack hosts.
function customLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: 4 }, (err, addresses) => {
    if (err) { callback(err); return; }
    if (options && options.all) {
      callback(null, addresses);
    } else {
      const first = addresses[0];
      callback(null, first.address, first.family);
    }
  });
}

const req = https.request("https://localhost:" + port, {
  lookup: customLookup,
  ca,
}, (res) => {
  let data = "";
  res.on("data", (chunk) => data += chunk);
  res.on("end", () => {
    console.log("status:" + res.statusCode + " body:" + data);
  });
});
req.on("error", (e) => {
  console.error("error:" + e.message + " " + (e.code || ""));
  process.exitCode = 1;
});
req.end();
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("certificate");
    expect(stderr).not.toContain("CERT_ALTNAME");
    expect(stdout).toContain("status:200");
    expect(stdout).toContain("body:OK");
    expect(exitCode).toBe(0);
  }, 30_000);
});
