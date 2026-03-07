import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("custom lookup with HTTPS", () => {
  test("https.request with custom lookup should not break TLS", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const https = require("https");
const dns = require("dns");

function customLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) { callback(err, ""); return; }
    const first = addresses[0];
    if (options && options.all) {
      callback(null, addresses);
    } else {
      callback(null, first.address, first.family);
    }
  });
}

const req = https.request("https://example.com", { lookup: customLookup }, (res) => {
  console.log("status:" + res.statusCode);
  res.resume();
  res.on("end", () => process.exit(0));
});
req.on("error", (e) => {
  console.error("error:" + e.message);
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
    expect(stdout).toContain("status:");
    expect(exitCode).toBe(0);
  });

  test("https.request without custom lookup should still work", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const https = require("https");
const req = https.request("https://example.com", (res) => {
  console.log("status:" + res.statusCode);
  res.resume();
  res.on("end", () => process.exit(0));
});
req.on("error", (e) => {
  console.error("error:" + e.message);
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
    expect(stdout).toContain("status:");
    expect(exitCode).toBe(0);
  });

  test("custom lookup returning IP should preserve hostname for TLS SNI", async () => {
    // This test verifies the specific scenario from issue #27890:
    // A custom lookup that resolves hostname to IP should not break TLS.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const https = require("https");
const dns = require("dns");

// Custom lookup that behaves identically to the default
function customLookup(hostname, options, callback) {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) { callback(err, ""); return; }
    if (options && options.all) {
      callback(null, addresses.map(addr => ({ address: addr, family: 4 })));
    } else {
      callback(null, addresses[0], 4);
    }
  });
}

const req = https.request("https://example.com", { lookup: customLookup }, (res) => {
  console.log("status:" + res.statusCode);
  res.resume();
  res.on("end", () => process.exit(0));
});
req.on("error", (e) => {
  console.error("error:" + e.message);
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
    expect(stdout).toContain("status:");
    expect(exitCode).toBe(0);
  });
});
