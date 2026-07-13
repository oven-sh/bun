// Exercises the native subjectAltName walk in check_x509_server_identity
// (src/boringssl/lib.rs), which iterates the certificate's DNS and IP SANs
// via the bindgen-backed GeneralNames::subject_alt_names(). The fixture cert
// carries `DNS:localhost, IP:127.0.0.1, IP:::1`, so a Bun.connect client that
// trusts it directly should be authorized when connecting by hostname or by
// either IP literal, and not authorized for any other server name.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixtures = join(import.meta.dirname, "..", "http", "fixtures");
const cert = readFileSync(join(fixtures, "cert.pem"));
const key = readFileSync(join(fixtures, "cert.key"));

async function handshakeAuthorized(
  port: number,
  connectHost: string,
  serverName?: string,
): Promise<{ authorized: boolean; error: Error | null }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ authorized: boolean; error: Error | null }>();
  const socket = await Bun.connect({
    hostname: connectHost,
    port,
    // Trust the leaf directly so chain verification passes; only the
    // hostname/SAN check can make the socket unauthorized.
    tls: serverName === undefined ? { ca: cert } : { ca: cert, serverName },
    socket: {
      open() {},
      handshake(s) {
        resolve({ authorized: s.authorized, error: s.getAuthorizationError() });
        s.end();
      },
      data() {},
      drain() {},
      close() {},
      error(_s, err) {
        reject(err);
      },
      connectError(_s, err) {
        reject(err);
      },
    },
  });
  const result = await promise;
  socket.end();
  return result;
}

describe("Bun.connect subjectAltName verification", () => {
  test.concurrent.each([
    ["localhost", undefined, true], // DNS SAN: host_is_ip=false → GeneralName::Dns / match_dns_name
    ["127.0.0.1", undefined, true], // IP SAN:  host_is_ip=true  → GeneralName::Ip / ip2_string
    ["127.0.0.1", "not-in-san.example", false], // negative: serverName matches no SAN and no CN
  ] as const)("connect=%s serverName=%s -> authorized=%s", async (connectHost, serverName, expectAuthorized) => {
    await using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key, cert },
      socket: { open() {}, data() {}, drain() {}, close() {}, error() {} },
    });
    const { authorized, error } = await handshakeAuthorized(server.port, connectHost, serverName);
    expect({ authorized, code: (error as NodeJS.ErrnoException | null)?.code ?? null }).toEqual({
      authorized: expectAuthorized,
      code: expectAuthorized ? null : "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });
});
