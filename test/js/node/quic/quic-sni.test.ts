import { expect, test } from "bun:test";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

// The vendored Node suite exercises `sni` / `setSNIContexts()` but cannot
// observe which certificate was served (both fixtures are self-signed and the
// tests disable verification), so a no-op implementation passes it. These
// tests read the certificate the client actually received.

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const readKey = (name: string) => readFileSync(join(keysDir, name));

const cert1 = readKey("agent1-cert.pem");
const key1 = createPrivateKey(readKey("agent1-key.pem"));
const cert2 = readKey("agent2-cert.pem");
const key2 = createPrivateKey(readKey("agent2-key.pem"));

const identity1 = { keys: [key1], certs: [cert1] };
const identity2 = { keys: [key2], certs: [cert2] };

/** CN of the certificate the server presented for `servername`. */
async function servedCommonName(address, servername: string): Promise<string> {
  const session = await connect(address, {
    alpn: "quic-test",
    servername,
    verifyPeer: "manual",
  });
  try {
    await session.opened;
    const cert = session.peerCertificate;
    const x509 = cert instanceof X509Certificate ? cert : new X509Certificate(Buffer.from(cert));
    return x509.subject.match(/CN=([^\s,]+)/)![1];
  } finally {
    await session.close();
  }
}

function ignoreErrors(session) {
  session.onerror = () => {};
  session.opened.catch(() => {});
}

test("listen({ sni }) serves a different certificate per servername", async () => {
  const server = await listen(ignoreErrors, {
    sni: {
      "*": identity1,
      "agent2.example": identity2,
      "*.wild.example": identity2,
    },
    alpn: ["quic-test"],
  });

  try {
    // Exact match wins.
    expect(await servedCommonName(server.address, "agent2.example")).toBe("agent2");
    // One leading label matches a `*.suffix` entry.
    expect(await servedCommonName(server.address, "host.wild.example")).toBe("agent2");
    // Anything else falls back to the `*` identity.
    expect(await servedCommonName(server.address, "unknown.example")).toBe("agent1");
    // A wildcard must not match across a dot, nor the bare suffix.
    expect(await servedCommonName(server.address, "a.b.wild.example")).toBe("agent1");
    expect(await servedCommonName(server.address, "wild.example")).toBe("agent1");
  } finally {
    await server.close();
  }
});

test("setSNIContexts() replaces and merges identities", async () => {
  const endpoint = new QuicEndpoint();
  const server = await listen(ignoreErrors, {
    endpoint,
    sni: { "*": identity1 },
    alpn: ["quic-test"],
  });

  try {
    expect(await servedCommonName(server.address, "anything.example")).toBe("agent1");

    // replace: true swaps the whole map.
    endpoint.setSNIContexts({ "*": identity2 }, { replace: true });
    expect(await servedCommonName(server.address, "anything.example")).toBe("agent2");

    // replace: false merges, leaving the existing `*` in place.
    endpoint.setSNIContexts({ "merged.example": identity1 }, { replace: false });
    expect(await servedCommonName(server.address, "merged.example")).toBe("agent1");
    expect(await servedCommonName(server.address, "other.example")).toBe("agent2");
  } finally {
    await server.close();
  }
});

test("an identity with several cert/key pairs installs a matching pair", async () => {
  // Node pairs certs[i] with keys[i]. Installing certs[last] against keys[0]
  // fails BoringSSL's consistency check, so listen() used to throw here.
  const server = await listen(ignoreErrors, {
    sni: { "*": { keys: [key1, key2], certs: [cert1, cert2] } },
    alpn: ["quic-test"],
  });
  try {
    // BoringSSL's legacy API keeps one credential per SSL_CTX: the last pair.
    expect(await servedCommonName(server.address, "anything.example")).toBe("agent2");
  } finally {
    await server.close();
  }
});

test("setSNIContexts() rejects a non-object and a closed endpoint", async () => {
  const endpoint = new QuicEndpoint();
  expect(() => endpoint.setSNIContexts("nope" as any)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );

  const server = await listen(ignoreErrors, { endpoint, sni: { "*": identity1 }, alpn: ["quic-test"] });
  await server.close();
  expect(() => endpoint.setSNIContexts({ "*": identity2 })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_STATE" }),
  );
});

// The vendored test-quic-session-opened-validation.mjs only asserts that
// validationErrorCode is a non-empty string, so reporting the human-readable
// reason for it passes upstream too. Node sends the X509 code name
// (crypto::GetValidationErrorCode -> X509Pointer::ErrorCode) and real code
// switches on it, so assert the value.
test("opened reports the X509 code name for validationErrorCode", async () => {
  await using server = await listen(ignoreErrors, { sni: { "*": identity1 }, alpn: ["quic-test"] });

  // No `ca` on the client, so the self-signed agent1 chain cannot be verified.
  const session = await connect(server.address, {
    alpn: "quic-test",
    servername: "agent1",
    verifyPeer: "manual",
  });
  const info = await session.opened;
  await session.close();

  expect({ code: info.validationErrorCode, reason: info.validationErrorReason }).toEqual({
    code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    reason: "unable to get local issuer certificate",
  });
});
