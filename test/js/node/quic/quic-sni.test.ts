import { addBlockedSPKIForTesting, clearBlockedSPKIsForTesting } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint, type SessionOptions } from "node:quic";
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
  } as SessionOptions);
  try {
    await session.opened;
    const cert = session.peerCertificate;
    const x509 = cert instanceof X509Certificate ? cert : new X509Certificate(Buffer.from(cert as any));
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

// The client destroys itself as soon as it has 1-RTT keys. The listener reads its Finished and
// CONNECTION_CLOSE together, so lsquic frees the connection before the session reports the handshake.
test("session.certificate returns the servername's identity after lsquic frees the connection", async () => {
  const reported = Promise.withResolvers<unknown>();
  await using server = await listen(
    session => {
      ignoreErrors(session);
      session.closed.then(
        () => reported.reject(new Error("the session closed before it reported its handshake")),
        reported.reject,
      );
      session.onhandshake = info =>
        reported.resolve({
          servername: info.servername,
          certificate: (session.certificate as X509Certificate | undefined)?.subject.match(/CN=([^\s,]+)/)?.[1],
          peerMaxIdleTimeout: (session as any).remoteTransportParams?.maxIdleTimeout,
        });
    },
    { sni: { "*": identity1, "agent2.example": identity2 }, alpn: ["quic-test"] },
  );

  const client = await connect(server.address!, {
    alpn: "quic-test",
    servername: "agent2.example",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 5 },
    keylog: true,
    onkeylog(line) {
      if (line.startsWith("CLIENT_TRAFFIC_SECRET_0")) this.destroy(undefined, { code: 1n });
    },
    onerror() {},
  } as SessionOptions);
  client.opened.catch(() => {});
  client.closed.catch(() => {});

  expect(await reported.promise).toEqual({
    servername: "agent2.example",
    certificate: "agent2",
    peerMaxIdleTimeout: 5n,
  });
});

test("a certificate that isn't PEM is reported like in Node", async () => {
  const notPem = { keys: [key1], certs: [Buffer.from("not a certificate")] };
  const outcome = (run: () => unknown) =>
    Promise.resolve()
      .then(run)
      .then(
        () => "no error",
        (err: any) => `${err.code}: ${err.message}`,
      );
  await using server = await listen(() => {}, { sni: { "*": identity1 }, alpn: ["quic-test"] });
  await using forListen = new QuicEndpoint();
  await using forEntry = new QuicEndpoint();
  await using forConnect = new QuicEndpoint();
  expect({
    listen: await outcome(() => listen(() => {}, { endpoint: forListen, sni: { "*": notPem }, alpn: ["quic-test"] })),
    entry: await outcome(() =>
      listen(() => {}, { endpoint: forEntry, sni: { "*": identity1, "a.example": notPem }, alpn: ["quic-test"] }),
    ),
    connect: await outcome(() =>
      connect(server.address!, { endpoint: forConnect, alpn: "quic-test", ...notPem } as SessionOptions),
    ),
    setSNIContexts: await outcome(() => server.setSNIContexts({ "a.example": notPem })),
  }).toEqual({
    listen: "ERR_INVALID_STATE: Failed to create TLS context: NO_START_LINE",
    entry: "ERR_INVALID_STATE: Failed to create TLS context: NO_START_LINE",
    connect: "ERR_INVALID_STATE: Failed to create TLS context: NO_START_LINE",
    setSNIContexts: "ERR_INVALID_STATE: Failed to create TLS context: NO_START_LINE",
  });
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
  const session = await connect(server.address!, {
    alpn: "quic-test",
    servername: "agent1",
    verifyPeer: "manual",
  } as SessionOptions);
  const info = await session.opened;
  await session.close();

  expect({ code: info.validationErrorCode as unknown as string, reason: info.validationErrorReason }).toEqual({
    code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    reason: "unable to get local issuer certificate",
  });
});

test("opened reports CERT_REVOKED for a chain through a blocked public key", async () => {
  // agent6 -> ca3 (intermediate, bundled in agent6-cert.pem) -> ca1 (root).
  const identity = { keys: [createPrivateKey(readKey("agent6-key.pem"))], certs: [readKey("agent6-cert.pem")] };
  await using server = await listen(ignoreErrors, { sni: { "*": identity }, alpn: ["quic-test"] });
  async function validationError() {
    const session = await connect(server.address!, {
      alpn: "quic-test",
      servername: "agent6",
      verifyPeer: "manual",
      ca: [readKey("ca1-cert.pem")],
    } as SessionOptions);
    const info = await session.opened;
    await session.close();
    return { code: info.validationErrorCode, reason: info.validationErrorReason };
  }

  expect(await validationError()).toEqual({ code: undefined, reason: undefined });
  const intermediate = new X509Certificate(readKey("ca3-cert.pem")).publicKey.export({ type: "spki", format: "der" });
  addBlockedSPKIForTesting(createHash("sha256").update(intermediate).digest());
  try {
    expect(await validationError()).toEqual({ code: "CERT_REVOKED", reason: "certificate revoked" });
  } finally {
    clearBlockedSPKIsForTesting();
  }
});

test("every CRL in one `crl` entry counts", async () => {
  const identity = { keys: [createPrivateKey(readKey("agent3-key.pem"))], certs: [readKey("agent3-cert.pem")] };
  await using server = await listen(ignoreErrors, { sni: { "*": identity }, alpn: ["quic-test"] });
  const session = await connect(server.address!, {
    alpn: "quic-test",
    servername: "agent3",
    verifyPeer: "manual",
    ca: [readKey("ca2-cert.pem")],
    // Both are ca2's. The second one is newer, and it alone revokes agent3.
    crl: [Buffer.concat([readKey("ca2-crl.pem"), readKey("ca2-crl-agent3.pem")])],
  } as SessionOptions);
  const info = await session.opened;
  await session.close();
  expect(info.validationErrorCode as unknown as string).toBe("CERT_REVOKED");
});

test("verifyPeer 'strict' and 'auto' refuse a certificate with a blocked public key", async () => {
  // Unlike agent6's, this certificate names its host, which both modes check.
  const fixtures = join(import.meta.dir, "..", "tls", "fixtures");
  const cert = readFileSync(join(fixtures, "ed25519-cert.pem"));
  const key = createPrivateKey(readFileSync(join(fixtures, "ed25519-key.pem")));
  await using server = await listen(ignoreErrors, {
    sni: { "*": { keys: [key], certs: [cert] } },
    alpn: ["quic-test"],
  });
  async function open(verifyPeer: "strict" | "auto") {
    const session = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer,
      ca: [cert],
    } as SessionOptions);
    session.onerror = () => {};
    const closed = session.closed.catch(() => {});
    const outcome = await session.opened.then(
      () => "opened",
      err => err.message,
    );
    if (outcome === "opened") await session.close();
    await closed;
    return outcome;
  }

  expect([await open("strict"), await open("auto")]).toEqual(["opened", "opened"]);
  addBlockedSPKIForTesting(
    createHash("sha256")
      .update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" }))
      .digest(),
  );
  try {
    expect([await open("strict"), await open("auto")]).toEqual([
      // 'strict' fails the TLS handshake with alert certificate_revoked (44).
      "QUIC transport error 300: TLS alert 44",
      "QUIC transport error 0: Peer certificate validation failed: certificate revoked [CERT_REVOKED]",
    ]);
  } finally {
    clearBlockedSPKIsForTesting();
  }
});

test("verifyPeer 'strict' reports an untrusted certificate as the TLS alert's transport error", async () => {
  await using server = await listen(ignoreErrors, { sni: { "*": identity1 }, alpn: ["quic-test"] });
  const errors: unknown[] = [];
  const session = await connect(server.address!, {
    alpn: "quic-test",
    servername: "localhost",
    verifyPeer: "strict",
    onerror: (error: unknown) => void errors.push(error),
  } as SessionOptions);
  const outcome = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      err => ({ code: err.code, errorCode: err.errorCode }),
    );
  // CRYPTO_ERROR (0x100) + alert unknown_ca (48), as in Node.
  const unknownCA = { code: "ERR_QUIC_TRANSPORT_ERROR", errorCode: 0x130n };
  expect({ opened: await outcome(session.opened), closed: await outcome(session.closed), errors }).toEqual({
    opened: unknownCA,
    closed: unknownCA,
    errors: [expect.objectContaining(unknownCA)],
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

// The default CA store is built from the environment once per process, so this runs in a child.
test("a context without `ca` verifies against the default CA store", async () => {
  // bundled-root-probe-cert.pem names ISRG Root X1 as its issuer, but a throwaway key signed it:
  //   openssl req -x509 -newkey rsa:2048 -nodes -keyout fake.key -out fake.pem -days 2 \
  //     -subj "/C=US/O=Internet Security Research Group/CN=ISRG Root X1"
  //   openssl req -new -key agent1-key.pem -subj "/CN=bundled-root-probe" -out leaf.csr
  //   openssl x509 -req -in leaf.csr -CA fake.pem -CAkey fake.key -CAcreateserial -sha256 -extfile ext.cnf \
  //     -not_before 20260101000000Z -not_after 21260101000000Z -out bundled-root-probe-cert.pem
  // ext.cnf: basicConstraints=CA:FALSE, subjectKeyIdentifier=none, authorityKeyIdentifier=none,
  // subjectAltName=DNS:bundled-root-probe
  // A store with the bundled roots finds the issuer and fails the signature. A store without them finds no issuer.
  expect(rootCertificates.some(pem => new X509Certificate(pem).subject.includes("CN=ISRG Root X1"))).toBe(true);

  const script = `
    import { createPrivateKey } from "node:crypto";
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    import { connect, listen } from "node:quic";
    import { setDefaultCACertificates } from "node:tls";

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
          "*": identity("agent1"),
          agent3: identity("agent3"),
          "bundled-root-probe": identity("agent1", readFileSync(${JSON.stringify(join(import.meta.dir, "bundled-root-probe-cert.pem"))})),
        },
        alpn: ["quic-test"],
      },
    );

    async function verdict(servername, { ca, crl } = {}) {
      const session = await connect(server.address, {
        alpn: "quic-test",
        servername,
        ca: ca && [readKey(ca)],
        crl: crl && [readKey(crl)],
      });
      session.onerror = () => {};
      const outcome = await session.opened.then(() => "verified", e => e.message.match(/\\[(\\w+)\\]$/)?.[1] ?? e.message);
      await session.close();
      return outcome;
    }

    const verdicts = {
      SSL_CERT_FILE: await verdict("agent1"),
      NODE_EXTRA_CA_CERTS: await verdict("agent3"),
      bundledRoot: await verdict("bundled-root-probe"),
      caReplacesTheDefaults: await verdict("agent3", { ca: "ca1-cert.pem" }),
      crl: await verdict("agent3", { crl: "ca2-crl-agent3.pem" }),
      nextContextWithoutCrl: await verdict("agent3"),
    };
    setDefaultCACertificates([]);
    verdicts.emptyDefaultList = await verdict("agent3");
    setDefaultCACertificates([readKey("ca1-cert.pem")]);
    verdicts.inDefaultList = await verdict("agent1");
    verdicts.notInDefaultList = await verdict("agent3");
    console.log(JSON.stringify(verdicts));
    await server.close();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      SSL_CERT_FILE: join(keysDir, "ca1-cert.pem"),
      SSL_CERT_DIR: "",
      NODE_EXTRA_CA_CERTS: join(keysDir, "ca2-cert.pem"),
      NODE_USE_SYSTEM_CA: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      // The server finds ca2 in its own default store and sends it after agent3's certificate, like a node:tls server.
      SSL_CERT_FILE: "verified",
      NODE_EXTRA_CA_CERTS: "verified",
      bundledRoot: "CERT_SIGNATURE_FAILURE",
      caReplacesTheDefaults: "SELF_SIGNED_CERT_IN_CHAIN",
      crl: "CERT_REVOKED",
      nextContextWithoutCrl: "verified",
      emptyDefaultList: "SELF_SIGNED_CERT_IN_CHAIN",
      inDefaultList: "verified",
      notInDefaultList: "SELF_SIGNED_CERT_IN_CHAIN",
    }),
    stderr: expect.stringContaining(
      "ExperimentalWarning: quic is an experimental feature and might change at any time",
    ),
    exitCode: 0,
  });
});

// https://github.com/oven-sh/bun/issues/32234
test("a client verifies an Ed25519 server certificate", async () => {
  const fixtures = join(import.meta.dir, "..", "tls", "fixtures");
  const cert = readFileSync(join(fixtures, "ed25519-cert.pem"));
  const key = createPrivateKey(readFileSync(join(fixtures, "ed25519-key.pem")));
  await using server = await listen(ignoreErrors, {
    sni: { "*": { keys: [key], certs: [cert] } },
    alpn: ["quic-test"],
  });
  const session = await connect(server.address!, { alpn: "quic-test", servername: "localhost", ca: [cert] });
  try {
    expect(await session.opened).toMatchObject({ validationErrorCode: undefined, validationErrorReason: undefined });
  } finally {
    await session.close();
  }
});

test("connect() refuses a servername with a NUL byte", async () => {
  await using server = await listen(ignoreErrors, { sni: { "*": identity1 }, alpn: ["quic-test"] });
  expect(
    (async () =>
      connect(server.address!, {
        alpn: "quic-test",
        servername: "agent2.example\0evil",
        verifyPeer: "manual",
      } as SessionOptions))(),
  ).rejects.toThrow("servername must not contain null bytes");
});

// `tls` from harness has the SANs DNS:localhost, IP:127.0.0.1 and IP:::1.
const ipSanIdentity = { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] };

// https://github.com/oven-sh/bun/issues/45514
test.each(["127.0.0.1", "::1"])("verifies the IP servername %s against the certificate's IP SANs", async servername => {
  await using server = await listen(ignoreErrors, { sni: { "*": ipSanIdentity }, alpn: ["quic-test"] });
  const session = await connect(server.address!, { alpn: "quic-test", servername, ca: [Buffer.from(tls.cert)] });
  try {
    expect(await session.opened).toMatchObject({ validationErrorCode: undefined, validationErrorReason: undefined });
  } finally {
    await session.close();
  }
});

test.each([
  ["127.0.0.2", "IP address mismatch"],
  ["::2", "IP address mismatch"],
  ["example.com", "Hostname mismatch"],
])("rejects the servername %s when no SAN matches it", async (servername, reason) => {
  await using server = await listen(ignoreErrors, { sni: { "*": ipSanIdentity }, alpn: ["quic-test"] });
  const session = await connect(server.address!, { alpn: "quic-test", servername, ca: [Buffer.from(tls.cert)] });
  ignoreErrors(session);
  try {
    await expect(session.opened).rejects.toThrow(`Peer certificate validation failed: ${reason}`);
  } finally {
    session.destroy();
  }
});
