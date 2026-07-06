import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls, { connect, createServer, type PeerCertificate, type Server } from "node:tls";

// A server configured with the array form of `key`/`cert` holds more than one
// identity (here an RSA leaf and an ECDSA leaf). Each must reach the handshake
// so the server can serve whichever one the client can use.
describe("array key/cert (multiple identities)", () => {
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name));
  const rsaKey = fixture("agent1-key.pem");
  const rsaCert = fixture("agent1-cert.pem");
  const ecKey = fixture("ec10-key.pem");
  const ecCert = fixture("ec10-cert.pem");
  const RSA_CN = "agent1";
  const EC_CN = "agent10.example.com";

  async function servedLeafCN(port: number, extra: object): Promise<string | undefined> {
    const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
    const socket = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...extra }, () =>
      resolve((socket.getPeerCertificate() as PeerCertificate).subject?.CN),
    );
    socket.on("error", reject);
    try {
      return await promise;
    } finally {
      socket.destroy();
    }
  }

  // Node pairs the two arrays by key algorithm rather than by index, so the
  // crossed order below describes exactly the same two identities.
  const orders: [string, Buffer[], Buffer[]][] = [
    ["index-aligned", [rsaKey, ecKey], [rsaCert, ecCert]],
    ["crossed", [ecKey, rsaKey], [rsaCert, ecCert]],
  ];

  for (const [label, key, cert] of orders) {
    it(`serves the RSA leaf to an RSA-only client and the ECDSA leaf otherwise (${label})`, async () => {
      const server: Server = createServer({ key, cert }, socket => socket.end());
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      try {
        expect(await servedLeafCN(port, { maxVersion: "TLSv1.2", ciphers: "ECDHE-RSA-AES128-GCM-SHA256" })).toBe(
          RSA_CN,
        );
        expect(await servedLeafCN(port, { maxVersion: "TLSv1.2", ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256" })).toBe(
          EC_CN,
        );
        // ECDSA outranks RSA in the default signature-algorithm preference, so
        // a TLS 1.3 client gets the EC leaf whichever order the arrays used.
        expect(await servedLeafCN(port, {})).toBe(EC_CN);
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  }

  it("rejects a certificate that none of the keys belongs to", () => {
    expect(() => tls.createSecureContext({ key: [rsaKey], cert: [rsaCert, ecCert] })).toThrow(
      expect.objectContaining({ code: "ERR_OSSL_X509_KEY_VALUES_MISMATCH" }),
    );
  });
});
