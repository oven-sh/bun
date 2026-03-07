import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";

// Uses a local HTTPS server with self-signed certs to avoid CI environments
// lacking system CA certificates (Windows, Alpine).
describe("custom lookup with HTTPS", () => {
  test("https.request with custom lookup should not break TLS", async () => {
    using server = Bun.serve({
      tls,
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
const ca = ${JSON.stringify(tls.cert)};

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
    process.exit(0);
  });
});
req.on("error", (e) => {
  console.error("error:" + e.message + " " + (e.code || ""));
  process.exit(1);
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
      tls,
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
const ca = ${JSON.stringify(tls.cert)};

const req = https.request("https://localhost:" + port, { ca }, (res) => {
  let data = "";
  res.on("data", (chunk) => data += chunk);
  res.on("end", () => {
    console.log("status:" + res.statusCode + " body:" + data);
    process.exit(0);
  });
});
req.on("error", (e) => {
  console.error("error:" + e.message + " " + (e.code || ""));
  process.exit(1);
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

  test("custom lookup returning IP should preserve hostname for TLS SNI", async () => {
    // This test verifies the specific scenario from issue #27890:
    // A custom lookup that resolves hostname to IP should not break TLS.
    // The lookup returns a raw IP, but the original hostname ("localhost")
    // must be preserved for SNI and certificate SAN matching.
    using server = Bun.serve({
      tls,
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
const ca = ${JSON.stringify(tls.cert)};

// Custom lookup that returns only the IP without using dns module at all.
// This is the most direct reproduction of the bug: hostname -> IP mapping.
function customLookup(hostname, options, callback) {
  const addr = "127.0.0.1";
  if (options && options.all) {
    callback(null, [{ address: addr, family: 4 }]);
  } else {
    callback(null, addr, 4);
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
    process.exit(0);
  });
});
req.on("error", (e) => {
  console.error("error:" + e.message + " " + (e.code || ""));
  process.exit(1);
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
