import { describe, expect, test } from "bun:test";
import { tls as harnessCert } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

// Self-signed cert with ONLY an IP SAN (IP:127.0.0.1) and no DNS names.
// Generated via:
//   openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
//     -subj "/CN=127.0.0.1" -addext "subjectAltName = IP:127.0.0.1"
// notAfter=Apr 15 02:50:38 2036 GMT
const ipOnlyCert = Object.freeze({
  cert:
    "-----BEGIN CERTIFICATE-----\n" +
    "MIIDGjCCAgKgAwIBAgIUKHNXrK2wJedEQr9JekCE3PoAPX4wDQYJKoZIhvcNAQEL\n" +
    "BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDQxODAyNTAzOFoXDTM2MDQx\n" +
    "NTAyNTAzOFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF\n" +
    "AAOCAQ8AMIIBCgKCAQEAp4amJy6qyxNPy8L01Rj9vHaLFuR1x46KCoXEB8n/+NC1\n" +
    "YBtu5JRa2X52YVxPjJAQuXp4qjz0frY6gDEWgwcUwIql4pPMVSOXt3/QYh16Ftzk\n" +
    "cipJhRTGgofhSTKgmqTR7yBz6xwLeXnKqzAXJmA9k/ixN0kxq1EFjnZp+avZCysm\n" +
    "DrJK6rncXm83KOdbsK8sl6t5xJqvX3qpJOzLZZlLfEBUICaan66TgyxskqDB24E3\n" +
    "16v2zxdLhe2pt1KFKnxmAlqAzC46pVXZoI1q8fZF7ckDJzB9jN9w9Pu3HJtctwy/\n" +
    "2brcIFI0qKPU4EYXgG/S1fk7/ElksZu2L+D2y1+G/wIDAQABo2QwYjAdBgNVHQ4E\n" +
    "FgQUlKMTREVTuSlAzkawmiNiYtrPoCowHwYDVR0jBBgwFoAUlKMTREVTuSlAzkaw\n" +
    "miNiYtrPoCowDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMA0GCSqG\n" +
    "SIb3DQEBCwUAA4IBAQBTBl23fX/ynew7myCJ53IXb6zdYQpMGZ/SwgkTl2G6VbiK\n" +
    "UJJqAOfHfsG0eOVfFtqo7FEycjcQqqjR8vnGHxmb55Q7OUu/bhGWKa5EaxkmJrsz\n" +
    "H5azJTrZoNYNAz3d2TCpxgwW0ZZH398n7xHnsXqnLEUupGIX+x6i9eBcsEiVfQE+\n" +
    "pTVoDQp8ECIH75EgCtNsKildABTYUoKTXv+GNJYuxFxgwjDvaKKoccfPpapsCCnm\n" +
    "UzTLswXqKsskfkQeu2qiKIqSUojHUDkQ6JS8sqD0jjqNYt5MD7I4xWflidoWmvvL\n" +
    "CfCrOn+96qNKy9alTXXp+9YLsN+HiHexzrEwXL3E\n" +
    "-----END CERTIFICATE-----\n",
  key:
    "-----BEGIN PRIVATE KEY-----\n" +
    "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnhqYnLqrLE0/L\n" +
    "wvTVGP28dosW5HXHjooKhcQHyf/40LVgG27klFrZfnZhXE+MkBC5eniqPPR+tjqA\n" +
    "MRaDBxTAiqXik8xVI5e3f9BiHXoW3ORyKkmFFMaCh+FJMqCapNHvIHPrHAt5ecqr\n" +
    "MBcmYD2T+LE3STGrUQWOdmn5q9kLKyYOskrqudxebzco51uwryyXq3nEmq9feqkk\n" +
    "7MtlmUt8QFQgJpqfrpODLGySoMHbgTfXq/bPF0uF7am3UoUqfGYCWoDMLjqlVdmg\n" +
    "jWrx9kXtyQMnMH2M33D0+7ccm1y3DL/ZutwgUjSoo9TgRheAb9LV+Tv8SWSxm7Yv\n" +
    "4PbLX4b/AgMBAAECggEAN8oGkSvgYuqWe1P8du7wqQ+NOF1yv7c/T0vGwZVKslDG\n" +
    "5i+cmXCyZJXR1JCKSVQ8zZf0kTTlc0E6cDBov8/e4FQL9E2mEYBd6RUej14jp3N+\n" +
    "fGqKu0/038lihB7hDz7uTsUu9VAMnjKqBKJqQzRvrVR3p+KvMM81m4Dhv+yzxhzY\n" +
    "dIZnsRNPLCCGFy9lsQoSMjYG0yhvnY21dP8vaGsr4N8ykICc6N7mQydozN74PWyG\n" +
    "m5OCVYPyqCukWshRKYVv0h/wrJtg7xN1g6qQulrDUYPWofL9+sX8GdR6jKNIit2e\n" +
    "59473wi1eA402IwR7TG+Lo9pP67FvgCvasXIIybC8QKBgQDq1z9gtKyz77pNYKgj\n" +
    "gBDnT9UvyOtEl7zkpNLbXF+UrYSQOm6WF4oT+HsDASSmX6eLk2dBx6FDrK5Rf2j6\n" +
    "ar6I02FAz+dH1YDJpvO4Src2riUy2kZnzho9cUg1ngjUoGMv8cTlBtELpqUcqwn7\n" +
    "M18RkhtEt/kdHSFfqpPA5UkNZwKBgQC2nr3ycJIZXc7MTBgsQXb/N0ut2O1aN9OA\n" +
    "pdD/cRW5VzUOfWSgbNaQkpdHeoVTWPsRIP7zrVC0cARfl2VHZi25z9xNsObUSTHN\n" +
    "TVZpcApusIw/PfynYi0+rusQmFIrNhWPU1si/SiqaYldil6mHBwU1d76FLPfCT3g\n" +
    "2uQCGfIiqQKBgQDdbauioXkeCHIft32SS5Skpg+biNTczj4bUJZIo6az55BQ9eeD\n" +
    "uhpFjkten9tQzGyMHKaFzZdu2glbaskvJSsWlEjk9aNbhiJzAOpY4Io0EquccVdl\n" +
    "VV5EhOXTOHmXEsuzT0GZuX2ugKi6iUNWCjAfvyXa+6T2IJtxOsMqZIcnDQKBgEhf\n" +
    "GH+fxQZweqfT8DB5sSLrUv6OXWHHhfYRwIW61xUgTlJztxEskMuyjGkzUOr69GSR\n" +
    "YvhG0xju24zWfriQ8cYVbgUL+i5e43GtGHWohTnglXPqqNncunmA8H8fHlEpmdm2\n" +
    "+wMeuKLwOBPt5hyGP0qyhy8sTSwyiWc21+1NQvwhAoGBAN0kiURpPVmof+2yOA6n\n" +
    "j2d3I+xLSpTs+zME/7OXmyypbP97ZxGPAIfRRJuErsU+864zAIHFsychwY1T4WUF\n" +
    "l5m/TODsZgl7cvZSgdLA/EpFMYDMJ6xWExDgcBYXv+srNdfxHOEUyG9yRh9wXwrP\n" +
    "Usxcx2yXXzi51UyojcIr0PS8\n" +
    "-----END PRIVATE KEY-----\n",
});

type Result = { ok: true; authorized: boolean } | { ok: false; code: string | undefined; message: string };

async function withTlsServer<T>(serverCert: { key: string; cert: string }, fn: (port: number) => Promise<T>) {
  const server = tls.createServer({ key: serverCert.key, cert: serverCert.cert }, c => c.end());
  server.on("tlsClientError", () => {}); // swallow; client-side asserts below
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await fn((server.address() as net.AddressInfo).port);
  } finally {
    server.close();
  }
}

async function upgrade(port: number, options: tls.ConnectionOptions) {
  const raw = net.connect(port, "127.0.0.1");
  await once(raw, "connect");

  const { promise, resolve } = Promise.withResolvers<Result>();
  const tlsSocket = tls.connect({ socket: raw, ...options });
  tlsSocket.on("secureConnect", () => {
    resolve({ ok: true, authorized: tlsSocket.authorized });
    tlsSocket.destroy();
    raw.destroy();
  });
  tlsSocket.on("error", err => {
    resolve({ ok: false, code: (err as NodeJS.ErrnoException).code, message: err.message });
    tlsSocket.destroy();
    raw.destroy();
  });
  return promise;
}

// Regression: tls.connect({ socket, host: <ip> }) previously verified against
// "localhost" instead of the IP because the upgrade path never set self._host
// and self.servername is "" for IP hosts (no SNI). Node verifies against
// options.host in this case.
describe("tls.connect hostname verification over an existing socket", () => {
  test("checkServerIdentity receives options.host when host is an IP", async () => {
    await withTlsServer(harnessCert, async port => {
      let observedHostname: string | undefined;
      const result = await upgrade(port, {
        host: "127.0.0.1",
        ca: harnessCert.cert,
        checkServerIdentity(hostname, cert) {
          observedHostname = hostname;
          return tls.checkServerIdentity(hostname, cert);
        },
      });
      // Must be verified against the IP we passed, not the "localhost" default.
      expect(observedHostname).toBe("127.0.0.1");
      expect(result).toEqual({ ok: true, authorized: true });
    });
  });

  test("authorizes a cert whose only SAN is IP:127.0.0.1 when upgrading with host: '127.0.0.1'", async () => {
    await withTlsServer(ipOnlyCert, async port => {
      const result = await upgrade(port, { host: "127.0.0.1", ca: ipOnlyCert.cert });
      expect(result).toEqual({ ok: true, authorized: true });
    });
  });

  test("rejects with the correct IP in the error when options.host does not match the cert", async () => {
    await withTlsServer(ipOnlyCert, async port => {
      let observedHostname: string | undefined;
      const result = await upgrade(port, {
        host: "10.0.0.5",
        ca: ipOnlyCert.cert,
        checkServerIdentity(hostname, cert) {
          observedHostname = hostname;
          return tls.checkServerIdentity(hostname, cert);
        },
      });
      expect(observedHostname).toBe("10.0.0.5");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      // The error must reference the IP we asked to verify, not "localhost".
      expect(result.message).toContain("10.0.0.5");
      expect(result.message).not.toContain("localhost");
    });
  });

  test("direct tls.connect({ host: <ip>, port }) still verifies against the IP", async () => {
    // Sanity check that the non-upgrade path remains correct.
    await withTlsServer(ipOnlyCert, async port => {
      let observedHostname: string | undefined;
      const { promise, resolve } = Promise.withResolvers<Result>();
      const socket = tls.connect({
        host: "127.0.0.1",
        port,
        ca: ipOnlyCert.cert,
        checkServerIdentity(hostname, cert) {
          observedHostname = hostname;
          return tls.checkServerIdentity(hostname, cert);
        },
      });
      socket.on("secureConnect", () => {
        resolve({ ok: true, authorized: socket.authorized });
        socket.destroy();
      });
      socket.on("error", err => {
        resolve({ ok: false, code: (err as NodeJS.ErrnoException).code, message: err.message });
        socket.destroy();
      });
      const result = await promise;
      expect(observedHostname).toBe("127.0.0.1");
      expect(result).toEqual({ ok: true, authorized: true });
    });
  });
});
