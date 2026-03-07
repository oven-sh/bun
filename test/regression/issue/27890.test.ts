import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Self-signed cert with ONLY DNS:localhost in SANs (no IP SANs).
// This is critical: if the cert also had IP:127.0.0.1, the custom lookup
// tests would pass even without the SNI fix, since BoringSSL would match
// on the IP SAN directly. By excluding IP SANs, we ensure the test only
// passes when the original hostname ("localhost") is correctly preserved
// for TLS SNI and certificate SAN matching.
const localhostOnlyTls = {
  cert: `-----BEGIN CERTIFICATE-----
MIIDHzCCAgegAwIBAgIUcga2aoOjEE/OkAhzXyf0edlMQd8wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDMwNzEzNTgzM1oXDTM2MDMw
NDEzNTgzM1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEArmrPPlRhFDAXjDy/aMW7dDAviJGSLxtyUp+XMbUGCkxP
/fq0C84FFkj+0ETb1GSt7XuJMQOzHZzoGG1y0Yc4qacaMdNbbBDJhckHnW7Br2ic
3bripN/69WkFpy01mSUSIhYM9RwEz4nGOVqVEdbojW31FRC0YvdPPcTbMb8HqtDp
tpcB+lIJLUWUKSpDeRIhND+hqVq5wnvIfw8Eyq/6q6QTtoNGNpHSGCKHG12v/bsi
aTlbs4UVNCvn2f6hl4ciy5TDr/bB+VIbhULMzvIg/7AsleyAC8G7ce8ZR1ZaH5rS
UShy4ZmQgOmxqfIjrFpUN7zo9Gm+mT37+H5zOBeMMwIDAQABo2kwZzAdBgNVHQ4E
FgQUWkdG6xd/aJlEs0sEiSgYwP7Q0QYwHwYDVR0jBBgwFoAUWkdG6xd/aJlEs0sE
iSgYwP7Q0QYwDwYDVR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3Qw
DQYJKoZIhvcNAQELBQADggEBAKubGq3HLwQIurneHhDXmFozz7D5OPZaWgY9B0oZ
HI57NgDgq/4GKy4YFaJASBFHwOt7yGZLwhxVzXw0xHpaxpFt78I//9n2jpBEZUgt
WMrm9nbX863P0IFBnvqOK3+CAIoMNkQVADl/4XmV/Lp06SpE9u3JEMMOItvUU1HL
jFbOHYpMv6pPqwvHymIMkGRh3Mf9ntdUug02LdCFfPF6ee1KzGjOj22j9nFC/hKe
gE3wV1GWJ/D+v4nyEMCxdyz6gATk17f0mFlsNoASKNgh30bQnpbzQ5GqkSeQbuAc
apKwXYUiw1lvsC+kjH4CY2H/f7GNuIl1eru/xIvF360I2v8=
-----END CERTIFICATE-----`,
  key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCuas8+VGEUMBeM
PL9oxbt0MC+IkZIvG3JSn5cxtQYKTE/9+rQLzgUWSP7QRNvUZK3te4kxA7MdnOgY
bXLRhzippxox01tsEMmFyQedbsGvaJzduuKk3/r1aQWnLTWZJRIiFgz1HATPicY5
WpUR1uiNbfUVELRi9089xNsxvweq0Om2lwH6UgktRZQpKkN5EiE0P6GpWrnCe8h/
DwTKr/qrpBO2g0Y2kdIYIocbXa/9uyJpOVuzhRU0K+fZ/qGXhyLLlMOv9sH5UhuF
QszO8iD/sCyV7IALwbtx7xlHVlofmtJRKHLhmZCA6bGp8iOsWlQ3vOj0ab6ZPfv4
fnM4F4wzAgMBAAECggEAAyyvgUzA3ZYIf7Aasxn85kmlkStGdAlgWc+iIrCkSlYG
6LJXn5VhiKfNzNWhWKrNHZ2aKs8MmLU35jtBE+ji/PeCewtZRndsa5Jz9dzDtWEb
5c9BJnYV18H7F9wIoIpzsN93ieiMz92L7ZRP/UdM6/IR5rnAnBfbPzO7jPATVXu4
lGydb6fweJt6cngdzkqyg4a2LvBGnwfkAcljgC7JTwmgz2KPK02eFnkSTBPVIFia
myOsd7hGZQP4jpuFA7MNlFhHLN6DSbRTAy46eI9flsPkNqnvAVbeRL7zPgnLz7vI
aUsMWurar9LwZYxA8AP1Duae3rfdifpyYdgHAk5YCQKBgQDd2TV9DmijlYdSw254
e++0Ejr1QiJklZtSwGYCKMStWcKx6hjQbrk9n4jdEHlAFi0gfUWeV254tVV5m0LV
XF6bQOK5x5G7uUFyz658O/aJ3v0jd6K3SI6AHKVxCNpHqG0uiYPltMLAPumq9vAJ
5kKo2QEj441Vmzfqd3xM28836wKBgQDJRGPfyeLcDNzBP2lAC5WlEEzGYAoI2X8N
Z166QZEhN+zusMIwtEEoG1oCN6XC9T2b0ex0oMjcPs3LcVSdASl4nLfLEMX/KDf+
jeU6VdnT+iT3CwNIXTatoH/HS1FJ5sID1uzF++XQbyZJoE3vOOX4YDKJb/4Dg01+
W9Puj3/y2QKBgDWQzKl1YS6eXB5PsczFoAsKm9G8NjGzLd29NuQuk86HbcsnivZI
xdFrQ9CcuaoPsLW3iafB1JqwrgK+ylRaCT3TXOselMGO6Y6fNrIoiE6h2N1HdbJr
gnzMbeXtDUdgE3y5F2/PRXbFugXdufep8U5zlyLjPqz83XNvhkPIjzAhAoGBAJHj
2gVwoNnjFO2bWl6LRyjEHPK60OtDRL5hjJ+0QU/z6vHF/K0zK/u3f9IVpjkgbU0S
qLSNi6tidugeOTgpjHcaGnu+p9bhv1zsXBmh+2iVbNAKEpIUxzqqGZVLuhu4gjAo
Ta7hfd9NglJiObvK4Z/dkyReoqDHP5f1VjUZnaRZAoGBANuPnEaPgTjv6Lv3NjqE
M/sKb0vfIkbf16AIUfIPCX/3dB9ZsPVAeU71emfxnvl1SLQNmijkGt2DznhTos0I
belXYvjFDREen63KRwrx2cnjrEQLZZpCpKgSsPnJKp8uZDw0HFgA9xXAJcn/Hmim
RPw0MDRF9eHl8zQAko6mVftK
-----END PRIVATE KEY-----`,
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
const port = ${server.port};
const ca = ${JSON.stringify(localhostOnlyTls.cert)};

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
