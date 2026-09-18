import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import dns from "node:dns";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";

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

type Result = {
  status: number | undefined;
  body: string;
  // SNI hostname the server saw in the ClientHello (req.socket.servername),
  // echoed back in the x-servername response header. "false" when none was sent.
  servername: string;
};

function request(options: https.RequestOptions): Promise<Result> {
  const { promise, resolve, reject } = Promise.withResolvers<Result>();
  const req = https.request({ ...options, ca: localhostOnlyTls.cert }, res => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", chunk => (body += chunk));
    res.on("end", () => resolve({ status: res.statusCode, body, servername: res.headers["x-servername"] as string }));
  });
  req.on("error", reject);
  req.end();
  return promise;
}

// Uses a local HTTPS server with a self-signed cert to avoid CI environments
// lacking system CA certificates (Windows, Alpine).
describe.concurrent("custom lookup with HTTPS", () => {
  let server: https.Server;
  let port: number;

  beforeAll(async () => {
    server = https.createServer(localhostOnlyTls, (req, res) => {
      res.setHeader("x-servername", String((req.socket as TLSSocket).servername));
      res.end("OK");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  test("https.request with custom lookup should not break TLS", async () => {
    const lookedUp: string[] = [];
    // Resolve "localhost" to 127.0.0.1. Simulates the real-world scenario
    // where a custom lookup returns an IP address for a hostname.
    function customLookup(hostname: string, options: dns.LookupOptions, callback: Function) {
      lookedUp.push(hostname);
      if (options?.all) {
        callback(null, [{ address: "127.0.0.1", family: 4 }]);
      } else {
        callback(null, "127.0.0.1", 4);
      }
    }

    const result = await request({ host: "localhost", port, lookup: customLookup });
    expect(result).toEqual({ status: 200, body: "OK", servername: "localhost" });
    expect(lookedUp).toEqual(["localhost"]);
  });

  test("https.request without custom lookup should still work", async () => {
    const result = await request({ host: "localhost", port });
    expect(result).toEqual({ status: 200, body: "OK", servername: "localhost" });
  });

  test("custom lookup via dns.lookup should preserve hostname for TLS SNI", async () => {
    // This is the exact scenario from issue #27890: a custom lookup that uses
    // dns.lookup (which checks /etc/hosts) to resolve "localhost" to an IP.
    // The original hostname must still be used for SNI and certificate SAN
    // matching. Forces IPv4 to avoid inconsistent results on dual-stack hosts.
    const resolved: { hostname: string; addresses: string[] }[] = [];
    function customLookup(hostname: string, options: dns.LookupOptions, callback: Function) {
      dns.lookup(hostname, { all: true, family: 4 }, (err, addresses) => {
        if (err) return callback(err);
        // dns.lookup may list the same hosts-file entry more than once.
        resolved.push({ hostname, addresses: [...new Set(addresses.map(a => `${a.address}/${a.family}`))] });
        if (options?.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      });
    }

    const result = await request({ host: "localhost", port, lookup: customLookup });
    expect(result).toEqual({ status: 200, body: "OK", servername: "localhost" });
    expect(resolved).toEqual([{ hostname: "localhost", addresses: ["127.0.0.1/4"] }]);
  });

  test("connecting by IP fails certificate verification (cert has no IP SAN)", async () => {
    // Proves the cert cannot be matched by IP. If the custom lookup tests
    // above leaked the resolved IP into SNI or hostname verification, they
    // would fail with this same error.
    await expect(request({ host: "127.0.0.1", port })).rejects.toMatchObject({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });
});
