import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";
import { rootCertificates } from "node:tls";

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

test("connect() with the default verifyPeer refuses an unverifiable certificate before a pending stream reaches the server", async () => {
  const script = `
    import { createPrivateKey } from "node:crypto";
    import { readFileSync } from "node:fs";
    import { connect, listen } from "node:quic";

    const cert = readFileSync(${JSON.stringify(join(keysDir, "agent1-cert.pem"))});
    const key = createPrivateKey(readFileSync(${JSON.stringify(join(keysDir, "agent1-key.pem"))}));

    let streamsReceived = 0;
    const server = await listen(
      serverSession => {
        serverSession.onerror = () => {};
        serverSession.opened.catch(() => {});
        serverSession.closed.catch(() => {});
        serverSession.onstream = stream => {
          streamsReceived++;
          stream.closed.catch(() => {});
          try {
            const w = stream.writer;
            w.writeSync(new Uint8Array([streamsReceived]));
            w.endSync();
          } catch {}
        };
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
    );

    const session = await connect(server.address, { alpn: "quic-test", servername: "agent1" });
    session.onerror = () => {};
    const openedError = session.opened.then(() => undefined, e => e);
    const closedSettled = session.closed.then(() => {}, () => {});
    const pending = await session.createBidirectionalStream({ body: Buffer.alloc(1024, 97) });
    pending.closed.catch(() => {});
    const err = await openedError;
    await closedSettled;

    const probe = await connect(server.address, { alpn: "quic-test", servername: "agent1", verifyPeer: "manual" });
    probe.onerror = () => {};
    await probe.opened;
    const stream = await probe.createBidirectionalStream({ body: Buffer.from("probe") });
    const chunks = [];
    for await (const batch of stream) chunks.push(...batch);
    await probe.close();

    console.log(
      JSON.stringify({
        code: err?.code,
        message: err?.message,
        echoed: [...Buffer.concat(chunks)],
        streamsReceived,
      }),
    );
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      code: "ERR_QUIC_TRANSPORT_ERROR",
      message:
        "QUIC transport error 0: Peer certificate validation failed: unable to get local issuer certificate [UNABLE_TO_GET_ISSUER_CERT_LOCALLY]",
      echoed: [1],
      streamsReceived: 1,
    }),
    stderr: expect.stringContaining(
      "ExperimentalWarning: quic is an experimental feature and might change at any time",
    ),
    exitCode: 0,
  });
});

// With no `ca`, Node verifies against its root store (node/src/quic/tlscontext.cc, GetOrCreateRootCertStore). Bun's
// default CA store is the counterpart: the bundled roots, OpenSSL's default paths, NODE_EXTRA_CA_CERTS and, with
// --use-system-ca, the system store. It is built from the environment once per process, so these run in a child.
// Not concurrent: a child takes about 2 s on a debug build, and several at once come close to the default timeout.
describe("a context with no `ca` option", () => {
  const rejected = (reason: string) => `QUIC transport error 0: Peer certificate validation failed: ${reason}`;
  const unknownIssuer = rejected("unable to get local issuer certificate [UNABLE_TO_GET_ISSUER_CERT_LOCALLY]");

  // This certificate names ISRG Root X1, a bundled root, as its issuer, but a throwaway key signed it. A store that
  // holds the root finds the issuer and then fails the signature. A store without the root finds no issuer.
  //   openssl req -x509 -newkey rsa:2048 -nodes -keyout fake.key -out fake.pem -days 2 \
  //     -subj "/C=US/O=Internet Security Research Group/CN=ISRG Root X1"
  //   openssl req -new -key agent1-key.pem -subj "/CN=bundled-root-probe" -out leaf.csr
  //   openssl x509 -req -in leaf.csr -CA fake.pem -CAkey fake.key -CAcreateserial -sha256 -extfile ext.cnf \
  //     -not_before 20260101000000Z -not_after 21260101000000Z -out bundled-root-probe-cert.pem
  // ext.cnf: basicConstraints=CA:FALSE, subjectKeyIdentifier=none, authorityKeyIdentifier=none,
  // subjectAltName=DNS:bundled-root-probe
  const bundledRootProbeCert = join(import.meta.dir, "bundled-root-probe-cert.pem");

  /**
   * The child runs one connect() per scenario, in order. Each outcome is "verified" or the message that `opened`
   * rejected with.
   * - `servername`: the client has the default `verifyPeer`, and the outcome is its verdict. The server has a
   *   certificate per servername: agent1 (issued by ca1), agent3 (issued by ca2), agent2 (self-signed) and
   *   bundled-root-probe.
   * - `clientCert`: the client presents that certificate to a second server, which has `verifyClient` and no `ca`.
   *   The outcome is the verdict of that server.
   *
   * `certFileOnStdin` makes $SSL_CERT_FILE a pipe that holds that file. A shell pipeline gives the child a real pipe.
   * A Blob stdin is a memfd, which every open reads from the start.
   */
  async function outcomes(
    env: Record<string, string>,
    scenarios: Record<string, { servername: string; ca?: string; crl?: string } | { clientCert: string }>,
    certFileOnStdin?: string,
  ): Promise<Record<string, string>> {
    const script = `
      import { createPrivateKey } from "node:crypto";
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      import { connect, listen } from "node:quic";

      const readKey = name => readFileSync(join(${JSON.stringify(keysDir)}, name));
      const identity = (agent, cert = readKey(agent + "-cert.pem")) => ({
        keys: [createPrivateKey(readKey(agent + "-key.pem"))],
        certs: [cert],
      });

      const server = await listen(
        serverSession => {
          serverSession.onerror = () => {};
          serverSession.opened.catch(() => {});
          serverSession.closed.catch(() => {});
        },
        {
          sni: {
            "*": identity("agent2"),
            agent1: identity("agent1"),
            agent3: identity("agent3"),
            "bundled-root-probe": identity("agent1", readFileSync(${JSON.stringify(bundledRootProbeCert)})),
          },
          alpn: ["quic-test"],
        },
      );

      let verifyClientVerdict;
      const verifyClientServer = await listen(
        serverSession => {
          serverSession.onerror = () => {};
          serverSession.closed.catch(() => {});
          serverSession.opened.then(() => verifyClientVerdict("verified"), e => verifyClientVerdict(e.message));
        },
        { sni: { "*": identity("agent1") }, alpn: ["quic-test"], verifyClient: true },
      );

      const outcomes = {};
      for (const [name, { servername, ca, crl, clientCert }] of Object.entries(${JSON.stringify(scenarios)})) {
        if (clientCert) {
          const verdict = new Promise(resolve => (verifyClientVerdict = resolve));
          const session = await connect(verifyClientServer.address, {
            alpn: "quic-test",
            servername: "agent1",
            verifyPeer: "manual",
            ...identity(clientCert),
          });
          session.onerror = () => {};
          session.opened.catch(() => {});
          // Rejects when the server refuses the certificate.
          const closed = session.closed.catch(() => {});
          outcomes[name] = await verdict;
          session.close();
          await closed;
          continue;
        }
        const session = await connect(server.address, {
          alpn: "quic-test",
          servername,
          ca: ca && [readKey(ca)],
          crl: crl && [readKey(crl)],
        });
        session.onerror = () => {};
        outcomes[name] = await session.opened.then(() => "verified", e => e.message);
        await session.close();
      }
      await Promise.all([server.close(), verifyClientServer.close()]);
      console.log(JSON.stringify(outcomes));
    `;

    await using proc = Bun.spawn({
      cmd: certFileOnStdin ? ["sh", "-c", 'cat "$CA" | "$BUN" -e "$SCRIPT"'] : [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        NODE_EXTRA_CA_CERTS: undefined,
        NODE_USE_SYSTEM_CA: undefined,
        SSL_CERT_FILE: "",
        SSL_CERT_DIR: "",
        ...env,
        ...(certFileOnStdin && { SSL_CERT_FILE: "/dev/stdin", CA: certFileOnStdin, BUN: bunExe(), SCRIPT: script }),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Before the parse, so that a child that crashed reports its stderr and not a JSON syntax error.
    expect({ stderr, exitCode }).toEqual({
      stderr: expect.stringContaining(
        "ExperimentalWarning: quic is an experimental feature and might change at any time",
      ),
      exitCode: 0,
    });
    return JSON.parse(stdout);
  }

  // agent2 is self-signed, so a store that holds it trusts it. The Linux system store holds every regular file in
  // $SSL_CERT_DIR. The default paths do not: their hash-directory lookup only opens <subject hash>.<n>.
  const certDirWithAgent2 = () => tempDir("quic-cert-dir", { "agent2.pem": readKey("agent2-cert.pem") });

  test("trusts the bundled roots, SSL_CERT_FILE and NODE_EXTRA_CA_CERTS", async () => {
    // If this root leaves the bundle, make bundled-root-probe-cert.pem again with the name of another one.
    expect(rootCertificates.some(pem => new X509Certificate(pem).subject.includes("CN=ISRG Root X1"))).toBe(true);

    using certDir = certDirWithAgent2();
    const env = {
      SSL_CERT_FILE: join(keysDir, "ca1-cert.pem"),
      SSL_CERT_DIR: String(certDir),
      NODE_EXTRA_CA_CERTS: join(keysDir, "ca2-cert.pem"),
    };
    expect(
      await outcomes(env, {
        "issuer in SSL_CERT_FILE": { servername: "agent1" },
        "issuer in NODE_EXTRA_CA_CERTS": { servername: "agent3" },
        "issuer with the name of a bundled root": { servername: "bundled-root-probe" },
        "self-signed, in SSL_CERT_DIR with no hash name": { servername: "agent2" },
        "`ca` without the issuer": { servername: "agent3", ca: "ca1-cert.pem" },
        "`ca`, and an issuer with the name of a bundled root": { servername: "bundled-root-probe", ca: "ca1-cert.pem" },
        // ca2-crl-agent3.pem revokes agent3. The `crl` goes into a copy of the store that only this context has.
        "`crl` that revokes the certificate": { servername: "agent3", crl: "ca2-crl-agent3.pem" },
        "next context, with no `crl`": { servername: "agent3" },
        "server with `verifyClient`, issuer in NODE_EXTRA_CA_CERTS": { clientCert: "agent3" },
        "server with `verifyClient`, self-signed": { clientCert: "agent2" },
      }),
    ).toEqual({
      "issuer in SSL_CERT_FILE": "verified",
      "issuer in NODE_EXTRA_CA_CERTS": "verified",
      "issuer with the name of a bundled root": rejected("certificate signature failure [CERT_SIGNATURE_FAILURE]"),
      "self-signed, in SSL_CERT_DIR with no hash name": rejected(
        "self signed certificate [DEPTH_ZERO_SELF_SIGNED_CERT]",
      ),
      "`ca` without the issuer": unknownIssuer,
      "`ca`, and an issuer with the name of a bundled root": unknownIssuer,
      "`crl` that revokes the certificate": rejected("certificate revoked [CERT_REVOKED]"),
      "next context, with no `crl`": "verified",
      "server with `verifyClient`, issuer in NODE_EXTRA_CA_CERTS": "verified",
      "server with `verifyClient`, self-signed": "QUIC transport error 304: handshake failed",
    });
  });

  // The test above has the same directory and no NODE_USE_SYSTEM_CA, and there agent2 is not trusted.
  test.skipIf(!isLinux)("trusts the system store with NODE_USE_SYSTEM_CA=1", async () => {
    using certDir = certDirWithAgent2();
    expect(
      await outcomes(
        { SSL_CERT_DIR: String(certDir), NODE_USE_SYSTEM_CA: "1" },
        { "self-signed, in SSL_CERT_DIR with no hash name": { servername: "agent2" } },
      ),
    ).toEqual({ "self-signed, in SSL_CERT_DIR with no hash name": "verified" });
  });

  // A pipe can be read only once, and the default store reads $SSL_CERT_FILE once for the process.
  test.skipIf(!isLinux)("trusts an SSL_CERT_FILE that is a pipe in every context", async () => {
    expect(
      await outcomes(
        {},
        { "first context": { servername: "agent1" }, "second context": { servername: "agent1" } },
        join(keysDir, "ca1-cert.pem"),
      ),
    ).toEqual({ "first context": "verified", "second context": "verified" });
  });
});
