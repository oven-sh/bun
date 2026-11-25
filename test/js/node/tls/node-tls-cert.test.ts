import { afterAll, describe, expect, it } from "bun:test";
import { ECDH, generateKeyPairSync, sign, X509Certificate, type KeyPairKeyObjectResult as KeyPair } from "crypto";
import { once } from "events";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tls as harnessCert, invalidTls, tempDir, tmpdirSync } from "harness";
import net, { type AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import type { Server, TLSSocket } from "node:tls";
import { join } from "path";
import tls from "tls";
type Certs = { key: string; cert: string; ca: string; single: string; subca: string };
const clientTls = {
  key: readFileSync(join(import.meta.dir, "fixtures", "ec10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "ec10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca5-cert.pem"), "utf8"),
} as Certs;
// The copy of ca2 under ./fixtures has a 1024-bit key, which Node rejects as "CA certificate key too weak".
const upstreamKeys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const serverTls = {
  key: readFileSync(join(upstreamKeys, "agent10-key.pem"), "utf8"),
  cert: readFileSync(join(upstreamKeys, "agent10-cert.pem"), "utf8"),
  ca: readFileSync(join(upstreamKeys, "ca2-cert.pem"), "utf8"),
} as Certs;

function split(file: any, into: any) {
  const certs = /([^]*END CERTIFICATE-----\r?\n)(-----BEGIN[^]*)/.exec(file) as RegExpExecArray;
  into.single = certs[1];
  into.subca = certs[2];
}

// Split out the single end-entity cert and the subordinate CA for later use.
split(clientTls.cert, clientTls);
split(serverTls.cert, serverTls);

// The certificates aren't for "127.0.0.1", so override the identity check.
function checkServerIdentity(hostname: string, cert: any): undefined {
  expect(hostname).toBe("127.0.0.1");
  expect(cert.subject.CN).toBe("agent10.example.com");
}

function connect(options: any) {
  let { promise, resolve, reject } = Promise.withResolvers();
  const server: any = {};
  const client: any = {};
  const pair = { server, client };

  function cleanup() {
    if (server.conn) server.conn.end();
    if (server.server) server.server.close();
    if (client.conn) client.conn.end();
  }
  let resolved = false;
  function resolveOrReject() {
    if (resolved) return;
    resolved = true;
    cleanup();
    const err = pair.client.err || pair.server.err;
    if (server.conn && client.conn) {
      if (err) {
        reject(err);
      }
      resolve(pair);
    } else {
      reject(err || new Error("Unable to secure connect"));
    }
  }

  try {
    server.server = tls
      .createServer(options.server, function (conn) {
        server.conn = conn;
        conn.pipe(conn);
        if (client.conn) {
          resolveOrReject();
        }
      })
      .on("tlsClientError", (err: any) => {
        server.err = err;
        resolveOrReject();
      })
      .on("error", err => {
        server.err = err;
        resolveOrReject();
      })
      .listen(0, function () {
        const optClient = { ...options.client, port: server.server.address().port, host: "127.0.0.1" };
        try {
          const conn = tls
            .connect(optClient, () => {
              client.conn = conn;
              if (server.conn) {
                resolveOrReject();
              }
            })
            .on("error", function (err) {
              client.err = err;
              resolveOrReject();
            })
            .on("close", function () {
              resolveOrReject();
            });
        } catch (err) {
          client.err = err;
          // The server won't get a connection, we are done.
          resolveOrReject();
        }
      });
  } catch (err) {
    // Invalid options can throw, report the error.
    server.err = err;
    resolveOrReject();
  }
  return promise;
}
it("complete cert chains sent to peer.", async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.cert,
      ca: serverTls.ca,
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca,
      requestCert: true,
    },
  });
});

it("complete cert chains sent to peer, but without requesting client's cert.", async () => {
  await connect({
    client: {
      ca: serverTls.ca,
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca,
    },
  });
});

it("Request cert from TLS1.2 client that doesn't have one.", async () => {
  try {
    await connect({
      client: {
        maxVersion: "TLSv1.2",
        ca: serverTls.ca,
        checkServerIdentity,
      },
      server: {
        key: serverTls.key,
        cert: serverTls.cert,
        ca: clientTls.ca,
        requestCert: true,
      },
    });
    expect.unreachable();
  } catch (err: any) {
    expect(err.code).toBe("ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE");
  }
});

it("Request cert from TLS1.3 client that doesn't have one.", async () => {
  // TLS 1.3 finishes the client's handshake before the server checks the
  // certificate, so the alert arrives after 'secureConnect'.
  // The agent10 fixtures above have a 1024-bit CA, which OpenSSL rejects as too
  // weak, so this case uses the 2048-bit harness certificate instead.
  const server = tls.createServer({
    key: harnessCert.key,
    cert: harnessCert.cert,
    ca: [harnessCert.cert],
    requestCert: true,
  });
  const serverError = once(server, "tlsClientError");
  await once(server.listen(0, "127.0.0.1"), "listening");

  try {
    const events: string[] = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    const client = tls.connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      minVersion: "TLSv1.3",
      ca: harnessCert.cert,
    });
    client.on("secureConnect", () => events.push("secureConnect"));
    client.on("data", () => events.push("data"));
    client.on("error", (err: any) => events.push(`error ${err.code}`));
    client.on("end", () => events.push("end"));
    client.on("close", (hadError: boolean) => {
      events.push(`close ${hadError}`);
      onClose();
    });
    await closed;

    // BoringSSL and OpenSSL name the same alert differently.
    const alert = (process.features as { openssl_is_boringssl?: boolean }).openssl_is_boringssl
      ? "ERR_SSL_TLSV1_ALERT_CERTIFICATE_REQUIRED"
      : "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED";
    expect(events).toEqual(["secureConnect", `error ${alert}`, "end", "close false"]);
    const [err] = await serverError;
    expect(err.code).toBe("ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE");
  } finally {
    server.close();
  }
});

it("Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer.", async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.single,
      ca: [serverTls.ca, serverTls.subca],
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.single,
      ca: [clientTls.ca, clientTls.subca],
      requestCert: true,
    },
  });
});

it("Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer. But using multi-PEM", async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.single,
      ca: serverTls.ca + "\n" + serverTls.subca,
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.single,
      ca: clientTls.ca + "\n" + clientTls.subca,
      requestCert: true,
    },
  });
});

it("Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer. But using multi-PEM in an array", async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.single,
      ca: [serverTls.ca + "\n" + serverTls.subca],
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.single,
      ca: [clientTls.ca + "\n" + clientTls.subca],
      requestCert: true,
    },
  });
});

it("Fail to complete server's chain", async () => {
  try {
    await connect({
      client: {
        ca: serverTls.ca,
        checkServerIdentity,
      },
      server: {
        key: serverTls.key,
        cert: serverTls.single,
      },
    });
    expect.unreachable();
  } catch (err: any) {
    expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  }
});

it("Fail to complete client's chain.", async () => {
  try {
    await connect({
      client: {
        key: clientTls.key,
        cert: clientTls.single,
        ca: serverTls.ca,
        checkServerIdentity,
      },
      server: {
        key: serverTls.key,
        cert: serverTls.cert,
        ca: clientTls.ca,
        requestCert: true,
      },
    });
    expect.unreachable();
  } catch (err: any) {
    expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  }
});

it("rejects an unverifiable client certificate by default when requestCert is true", async () => {
  // No explicit rejectUnauthorized: the documented default is true, so a client
  // certificate that fails CA verification must never reach the connection handler.
  const handled: string[] = [];
  const secureConnections: TLSSocket[] = [];
  let clientError: any = null;

  const server = tls.createServer(
    {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca,
      requestCert: true,
    },
    socket => {
      handled.push(socket.authorizationError as any);
      socket.pipe(socket);
    },
  );
  server.on("secureConnection", socket => secureConnections.push(socket));
  server.on("tlsClientError", err => {
    clientError = err;
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as AddressInfo).port;

  try {
    // Client 1: incomplete chain the server cannot verify. The server must drop it.
    const badClient = tls.connect({
      host: "127.0.0.1",
      port,
      key: clientTls.key,
      cert: clientTls.single,
      ca: serverTls.ca,
      checkServerIdentity,
      rejectUnauthorized: false,
    });
    badClient.on("error", () => {});
    // The server must tear the socket down; it must never hand it to the application.
    const outcome = await Promise.race([
      once(badClient, "close").then(() => "closed"),
      once(server, "secureConnection").then(() => "secureConnection"),
    ]);
    expect(outcome).toBe("closed");

    expect(clientError?.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(secureConnections).toHaveLength(0);
    expect(handled).toHaveLength(0);

    // Client 2: full verifiable chain. The server must still be alive and serve it,
    // proving the rejection above was a clean per-socket teardown.
    const goodClient = tls.connect({
      host: "127.0.0.1",
      port,
      key: clientTls.key,
      cert: clientTls.cert,
      ca: serverTls.ca,
      checkServerIdentity,
    });
    await once(goodClient, "secureConnect");
    const echoed = once(goodClient, "data");
    goodClient.write("ping");
    expect((await echoed)[0].toString()).toBe("ping");
    goodClient.end();
    await once(goodClient, "close");

    expect(handled).toHaveLength(1);
    expect(secureConnections).toHaveLength(1);
  } finally {
    server.close();
  }
});

it("client sees a hard error, not a clean close, when the server rejects its certificate under rejectUnauthorized", async () => {
  // TLS 1.2, so the refusal lands before the client's 'secureConnect'. A TLS 1.3 client finishes its handshake first.
  const untrustedClient = {
    key: readFileSync(join(import.meta.dir, "fixtures", "agent2-key.pem"), "utf8"),
    cert: readFileSync(join(import.meta.dir, "fixtures", "agent2-cert.pem"), "utf8"),
  };
  const server = tls.createServer(
    {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca,
      requestCert: true,
      rejectUnauthorized: true,
      maxVersion: "TLSv1.2",
    },
    socket => socket.end("SECRET"),
  );
  const refused = once(server, "tlsClientError");
  await once(server.listen(0, "127.0.0.1"), "listening");

  try {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const client = tls.connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      ca: serverTls.ca,
      ...untrustedClient,
      checkServerIdentity,
    });
    client.on("secureConnect", () => events.push("secureConnect"));
    client.on("data", data => events.push(`data ${data}`));
    client.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
    client.on("close", hadError => {
      events.push(`close ${hadError}`);
      closed.resolve();
    });
    await closed.promise;
    // The server sends neither its Finished nor an alert: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1214-L1232
    expect(events).toEqual(["error ECONNRESET", "close true"]);
    // Bun reports the certificate check to 'tlsClientError', Node how the connection ended.
    const [err] = await refused;
    expect(err.code).toBe(process.versions.bun ? "DEPTH_ZERO_SELF_SIGNED_CERT" : "ECONNRESET");
  } finally {
    server.close();
  }
});

it("explicit rejectUnauthorized: false still admits an unverified client certificate", async () => {
  const { promise: handledSocket, resolve: onHandledSocket } = Promise.withResolvers<TLSSocket>();

  const server = tls.createServer(
    {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca,
      requestCert: true,
      rejectUnauthorized: false,
    },
    socket => onHandledSocket(socket),
  );
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as AddressInfo).port;

  const client = tls.connect({
    host: "127.0.0.1",
    port,
    key: clientTls.key,
    cert: clientTls.single,
    ca: serverTls.ca,
    checkServerIdentity,
    rejectUnauthorized: false,
  });
  client.on("error", () => {});

  try {
    const [serverSocket] = await Promise.all([handledSocket, once(client, "secureConnect")]);
    expect(serverSocket.authorized).toBe(false);
    expect(serverSocket.authorizationError).toBe<string>("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  } finally {
    client.end();
    server.close();
  }
});

it("Fail to find CA for server.", async () => {
  try {
    await connect({
      client: {
        checkServerIdentity,
      },
      server: {
        key: serverTls.key,
        cert: serverTls.cert,
      },
    });
    expect.unreachable();
  } catch (err: any) {
    expect(err.code).toBe("UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
  }
});

it("Fail to find CA for server, which also sent a certificate with a blocked public key.", async () => {
  try {
    await connect({
      client: {
        checkServerIdentity,
      },
      server: {
        key: serverTls.key,
        cert:
          serverTls.cert +
          "\n" +
          readFileSync(join(import.meta.dir, "fixtures", "blocked-public-key-cert.pem"), "utf8"),
      },
    });
    expect.unreachable();
  } catch (err: any) {
    expect(err.code).toBe("CERT_REVOKED");
  }
});

it("Server sent their CA, but CA cannot be trusted if it is not locally known.", async () => {
  try {
    await connect({
      client: {
        checkServerIdentity,
      },
      server: {
        key: serverTls.key,
        cert: serverTls.cert + "\n" + serverTls.ca,
      },
    });
    expect.unreachable();
  } catch (err: any) {
    expect(err.code).toBe("SELF_SIGNED_CERT_IN_CHAIN");
  }
});

it("Server sent their CA, wrongly, but its OK since we know the CA locally.", async () => {
  await connect({
    client: {
      checkServerIdentity,
      ca: serverTls.ca,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.cert + "\n" + serverTls.ca,
    },
  });
});

it.todo('Confirm client support for "BEGIN TRUSTED CERTIFICATE".', async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.cert,
      ca: serverTls.ca.replace(/CERTIFICATE/g, "TRUSTED CERTIFICATE"),
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca,
      requestCert: true,
    },
  });
});

it.todo('Confirm server support for "BEGIN TRUSTED CERTIFICATE".', async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.cert,
      ca: serverTls.ca,
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca.replace(/CERTIFICATE/g, "TRUSTED CERTIFICATE"),
      requestCert: true,
    },
  });
});

it('Confirm client support for "BEGIN X509 CERTIFICATE".', async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.cert,
      ca: serverTls.ca.replace(/CERTIFICATE/g, "X509 CERTIFICATE"),
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca,
      requestCert: true,
    },
  });
});

it('Confirm server support for "BEGIN X509 CERTIFICATE".', async () => {
  await connect({
    client: {
      key: clientTls.key,
      cert: clientTls.cert,
      ca: serverTls.ca,
      checkServerIdentity,
    },
    server: {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: clientTls.ca.replace(/CERTIFICATE/g, "X509 CERTIFICATE"),
      requestCert: true,
    },
  });
});

it("Check getPeerCertificate can properly handle '\\0' for fix CVE-2009-2408.", async () => {
  let server: Server | null = null;
  let socket: TLSSocket | null = null;
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    server = tls
      .createServer({
        key: readFileSync(join(import.meta.dir, "fixtures", "0-dns-key.pem")),
        cert: readFileSync(join(import.meta.dir, "fixtures", "0-dns-cert.pem")),
      })
      .on("error", reject)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;
        socket = tls
          .connect(
            {
              host: address.address,
              port: address.port,
              rejectUnauthorized: false,
            },
            () => {
              const cert = socket?.getPeerCertificate();
              resolve(cert?.subjectaltname);
            },
          )
          .on("error", reject);
      });
    const subjectaltname = await promise;
    expect(subjectaltname).toBe(
      'DNS:"good.example.org\\u0000.evil.example.com", DNS:just-another.example.com, IP Address:8.8.8.8, IP Address:8.8.4.4, DNS:last.example.com',
    );
  } finally {
    //@ts-ignore
    socket?.end();
    server?.close();
  }
});

it.each([
  [
    "untrusted",
    {
      key: readFileSync(join(import.meta.dir, "fixtures", "agent1-key.pem")),
      cert: readFileSync(join(import.meta.dir, "fixtures", "agent1-cert.pem")),
    },
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "unable to verify the first certificate",
  ],
  [
    "untrusted and expired",
    {
      key: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.key")),
      cert: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.crt")),
      passphrase: "123123123",
    },
    "CERT_HAS_EXPIRED",
    "certificate has expired",
  ],
])("tls.connect should not accept %s certificates", async (_name, identity, code, message) => {
  const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
  let server: Server | null = null;
  let socket: TLSSocket | null = null;

  try {
    server = tls
      .createServer(identity)
      .on("error", reject)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;

        const options = {
          port: address.port,
          rejectUnauthorized: true,
        };
        socket = tls
          .connect(options, () => {
            reject(new Error("should not connect"));
          })
          .on("error", resolve);
      });

    const err = await promise;
    expect(err.code).toBe(code);
    expect(err.message).toBe(message);
  } finally {
    //@ts-ignore
    socket?.end();
    server?.close();
  }
});

async function createTLSServer(options: tls.TlsOptions) {
  const server = await new Promise<tls.Server>((resolve, reject) => {
    const server = tls
      .createServer(options)
      .on("error", reject)
      .listen(0, () => resolve(server));
  });

  const address = server.address() as AddressInfo;

  return {
    server,
    address,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

it("tls.connect should load extra CA from NODE_EXTRA_CA_CERTS", async () => {
  const caPath = join(tmpdirSync(), "ca.pem");
  await Bun.write(caPath, serverTls.ca);

  await using server = await createTLSServer({
    key: serverTls.key,
    cert: serverTls.cert,
    passphrase: "123123123",
  });

  const proc = Bun.spawn({
    env: {
      ...bunEnv,
      SERVER_PORT: server.address.port.toString(),
      NODE_EXTRA_CA_CERTS: caPath,
    },
    stderr: "pipe",
    stdout: "inherit",
    stdin: "inherit",
    cmd: [bunExe(), join(import.meta.dir, "node-tls-cert-extra-ca.fixture.js")],
  });

  expect(await proc.exited).toBe(0);
});

it("tls.connect should use NODE_EXTRA_CA_CERTS even if the used CA is not first in bundle", async () => {
  const bundlePath = join(tmpdirSync(), "bundle.pem");
  const bundleContent = `${clientTls.cert}\n${serverTls.ca}`;
  await Bun.write(bundlePath, bundleContent);

  await using server = await createTLSServer({
    key: serverTls.key,
    cert: serverTls.cert,
    passphrase: "123123123",
  });

  const proc = Bun.spawn({
    env: {
      ...bunEnv,
      SERVER_PORT: server.address.port.toString(),
      NODE_EXTRA_CA_CERTS: bundlePath,
    },
    stderr: "pipe",
    stdout: "inherit",
    stdin: "inherit",
    cmd: [bunExe(), join(import.meta.dir, "node-tls-cert-extra-ca.fixture.js")],
  });

  expect(await proc.exited).toBe(0);
});

it("tls.connect should ignore invalid NODE_EXTRA_CA_CERTS", async () => {
  await using server = await createTLSServer({
    key: serverTls.key,
    cert: serverTls.cert,
    passphrase: "123123123",
  });

  const results = await Promise.all(
    ["not-exist.pem", "", " "].map(async invalid => {
      const proc = Bun.spawn({
        env: {
          ...bunEnv,
          SERVER_PORT: server.address.port.toString(),
          NODE_EXTRA_CA_CERTS: invalid,
        },
        stderr: "pipe",
        stdout: "inherit",
        stdin: "inherit",
        cmd: [bunExe(), join(import.meta.dir, "node-tls-cert-extra-ca.fixture.js")],
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { invalid, stderr, exitCode };
    }),
  );

  for (const { stderr, exitCode } of results) {
    expect(stderr).toContain("UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
    expect(exitCode).toBe(1);
  }
});

it("tls.connect should ignore NODE_EXTRA_CA_CERTS if it contains invalid cert", async () => {
  const mixedValidAndInvalidCertsBundlePath = join(tmpdirSync(), "mixed-valid-and-invalid-certs-bundle.pem");
  await Bun.write(mixedValidAndInvalidCertsBundlePath, `${invalidTls.cert}\n${serverTls.ca}`);

  const mixedInvalidAndValidCertsBundlePath = join(tmpdirSync(), "mixed-invalid-and-valid-certs-bundle.pem");
  await Bun.write(mixedInvalidAndValidCertsBundlePath, `${serverTls.ca}\n${invalidTls.cert}`);

  await using server = await createTLSServer({
    key: serverTls.key,
    cert: serverTls.cert,
    passphrase: "123123123",
  });

  const results = await Promise.all(
    [mixedValidAndInvalidCertsBundlePath, mixedInvalidAndValidCertsBundlePath].map(async invalid => {
      const proc = Bun.spawn({
        env: {
          ...bunEnv,
          SERVER_PORT: server.address.port.toString(),
          NODE_EXTRA_CA_CERTS: invalid,
        },
        stderr: "pipe",
        stdout: "inherit",
        stdin: "inherit",
        cmd: [bunExe(), join(import.meta.dir, "node-tls-cert-extra-ca.fixture.js")],
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { invalid, stderr, exitCode };
    }),
  );

  for (const { stderr, exitCode } of results) {
    expect(stderr).toContain("Warning: Ignoring extra certs from");
    expect(exitCode).toBe(1);
  }
});
describe("tls ciphers should work", () => {
  [
    "", // when using BoringSSL we cannot set the cipher suites directly in this case, but we can set empty ciphers
    "ECDHE-RSA-AES128-GCM-SHA256",
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES256-GCM-SHA384",
    "ECDHE-ECDSA-AES256-GCM-SHA384",
    "ECDHE-RSA-AES128-SHA256",
  ].forEach(cipher_name => {
    it(`tls.connect should use ${cipher_name || "empty"}`, async () => {
      const server = tls.createServer({
        key: serverTls.key,
        cert: serverTls.cert,
        passphrase: "123123123",
        ciphers: cipher_name,
      });
      let socket: TLSSocket | null = null;
      try {
        await once(server.listen(0, "127.0.0.1"), "listening");

        socket = tls.connect({
          port: (server.address() as AddressInfo).port,
          host: "127.0.0.1",
          ca: serverTls.ca,
          ciphers: cipher_name,
          checkServerIdentity,
        });
        await once(socket, "secureConnect");
      } finally {
        socket?.end();
        server.close();
      }
    });
  });

  it("default ciphers should match expected", () => {
    expect(tls.DEFAULT_CIPHERS).toBe(
      "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA",
    );
  });
});

// A CA certificate in a trust source (`ca`, NODE_EXTRA_CA_CERTS, bundled, system) whose validity period does not
// cover "now" is treated as absent: it can neither shadow a currently-valid certificate for the same issuer that the
// server sends (Windows' system store caches stale intermediates — https://github.com/anthropics/claude-code/issues/71554)
// nor anchor a chain itself. Certificates the *server* sends are checked exactly as before.
describe("expired or not-yet-valid CA in the trust set", () => {
  const dir = join(import.meta.dir, "fixtures", "expired-intermediate");
  const F = Object.fromEntries(
    [
      "root", // self-signed, valid
      "root-expired", // same name+key as root, self-signed, expired 2021
      "oldroot-expired", // a different, expired self-signed root
      "root-cross-by-oldroot", // root's key certified by oldroot (valid dates)
      "int-valid", // CN=Bun Test Intermediate, issued by root — all int-* share one key
      "int-expired", // expired 2021
      "int-future", // notBefore 2100
      "int-constrained-valid", // nameConstraints permitted DNS:.example.com (leaf is localhost => violates)
      "int-constrained-expired",
      "leaf", // CN=localhost, issued by the intermediate key
    ].map(n => [n, readFileSync(join(dir, `${n}.pem`), "utf8")]),
  );
  const leafKey = readFileSync(join(dir, "leaf.key"), "utf8");

  async function connect(serverCert: string, ca: string[], extra: object = {}) {
    const server = tls.createServer({ key: leafKey, cert: serverCert });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      return await new Promise<string>(resolve => {
        const socket = tls.connect(
          { host: "127.0.0.1", port: (server.address() as AddressInfo).port, servername: "localhost", ca, ...extra },
          () => {
            resolve("authorized");
            socket.destroy();
          },
        );
        socket.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
      });
    } finally {
      server.close();
    }
  }

  // [name, server sends, client trusts, expected, tls.connect extras]. Where 1.4.0 differed, the old result is noted.
  const cases: [string, string[], string[], string, object?][] = [
    ["baseline: valid intermediate from server", ["leaf", "int-valid"], ["root"], "authorized"],
    ["expired intermediate from the SERVER is still expired", ["leaf", "int-expired"], ["root"], "CERT_HAS_EXPIRED"],
    // was CERT_HAS_EXPIRED: the trusted expired copy shadowed the server's valid one
    [
      "expired trusted intermediate does not shadow the server's valid one",
      ["leaf", "int-valid"],
      ["root", "int-expired"],
      "authorized",
    ],
    ["...in either order", ["leaf", "int-valid"], ["int-expired", "root"], "authorized"],
    // was CERT_NOT_YET_VALID
    [
      "not-yet-valid trusted intermediate does not shadow either",
      ["leaf", "int-valid"],
      ["root", "int-future"],
      "authorized",
    ],
    // absent as an anchor, but the failure still names the reason
    ["expired trusted intermediate is not an anchor", ["leaf"], ["root", "int-expired"], "CERT_HAS_EXPIRED"],
    ["not-yet-valid trusted intermediate is not an anchor", ["leaf"], ["root", "int-future"], "CERT_NOT_YET_VALID"],
    ["valid trusted intermediate is (server sends leaf only)", ["leaf"], ["root", "int-valid"], "authorized"],
    // pinning only an expired intermediate fails closed (was UNABLE_TO_GET_ISSUER_CERT: through it, then no root)
    ["ca = only the expired intermediate", ["leaf", "int-valid"], ["int-expired"], "CERT_HAS_EXPIRED"],
    [
      "ca = only the expired intermediate, partial chains allowed, server sends it",
      ["leaf", "int-expired"],
      ["int-expired"],
      "CERT_HAS_EXPIRED",
      { allowPartialTrustChain: true },
    ],
    // an exact match on an expired pinned cert is not a trust anchor either
    [
      "ca = only the expired intermediate, partial chains allowed, server sends the valid one",
      ["leaf", "int-valid"],
      ["int-expired"],
      "CERT_HAS_EXPIRED",
      { allowPartialTrustChain: true },
    ],
    [
      "ca = only the valid intermediate, partial chains allowed",
      ["leaf", "int-valid"],
      ["int-valid"],
      "authorized",
      { allowPartialTrustChain: true },
    ],
    // Name constraints apply to the paths that go through them, and trusting `root` means trusting what it issued.
    // (both "authorized" rows were UNSPECIFIED, i.e. rejected via the constrained copy)
    [
      "valid constrained trusted intermediate does not constrain the server's unconstrained one",
      ["leaf", "int-valid"],
      ["root", "int-constrained-valid"],
      "authorized",
    ],
    [
      "valid constrained trusted intermediate applies its constraints when it is the only path",
      ["leaf"],
      ["root", "int-constrained-valid"],
      "UNSPECIFIED",
    ],
    ["constrained intermediate from the server violates", ["leaf", "int-constrained-valid"], ["root"], "UNSPECIFIED"],
    [
      "expired constrained trusted intermediate is absent",
      ["leaf", "int-valid"],
      ["root", "int-constrained-expired"],
      "authorized",
    ],
    // Roots (the two "authorized" rows were CERT_HAS_EXPIRED)
    [
      "expired self-signed twin of the root does not shadow it",
      ["leaf", "int-valid"],
      ["root-expired", "root"],
      "authorized",
    ],
    ["only the expired twin trusted", ["leaf", "int-valid"], ["root-expired"], "CERT_HAS_EXPIRED"],
    [
      "cross-sign to an expired old root: the valid root anchors",
      ["leaf", "int-valid", "root-cross-by-oldroot"],
      ["oldroot-expired", "root"],
      "authorized",
    ],
    [
      "cross-sign to an expired old root: only the old root trusted",
      ["leaf", "int-valid", "root-cross-by-oldroot"],
      ["oldroot-expired"],
      "CERT_HAS_EXPIRED",
    ],
  ];
  for (const [name, chain, ca, expected, extra] of cases) {
    it(name, async () => {
      expect(
        await connect(
          chain.map(n => F[n]).join(""),
          ca.map(n => F[n]),
          extra,
        ),
      ).toBe(expected);
    });
  }

  it("a CA with a malformed validity field is rejected when the context is created, not ignored", () => {
    const der = Buffer.from(F["int-valid"].replace(/-----[^\n]+-----|\s/g, ""), "base64");
    // notBefore is a 13-byte UTCTime (tag 0x17, length 0x0d); corrupt one of its digits.
    const notBefore = der.indexOf(Buffer.from([0x17, 0x0d]));
    expect(notBefore).toBeGreaterThan(0);
    const bad = Buffer.from(der);
    bad[notBefore + 2] = 0x58; // 'X'
    const pem = `-----BEGIN CERTIFICATE-----\n${bad.toString("base64")}\n-----END CERTIFICATE-----\n`;
    expect(() => tls.createSecureContext({ ca: [F.root, pem] })).toThrow();
  });
});

describe("trust anchors", () => {
  const read = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "trust-anchor", name), "utf8");
  const pem = (names: string[]) => names.map(name => read(`${name}.pem`));
  const crls = (names: string[]) => names.map(name => read(`${name}.crl`));

  async function connect(chain: string[], clientOptions: tls.ConnectionOptions, serverOptions?: tls.TlsOptions) {
    await using server = tls.createServer({ key: read("leaf.key"), cert: pem(chain).join(""), ...serverOptions });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as AddressInfo).port;
    const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", ...clientOptions });
    const outcome = await once(socket, "secureConnect").then(
      () => "authorized",
      err => err.code,
    );
    socket.destroy();
    return outcome;
  }

  // The codes are those of Node.js v24.20.0.
  it.each([
    [["leaf", "intermediate"], "root", "authorized"],
    [["leaf", "intermediate"], "root-key-usage-only", "authorized"],
    [["leaf", "intermediate"], "root-pathlen-0", "PATH_LENGTH_EXCEEDED"],
    [["leaf", "intermediate"], "root-client-eku", "INVALID_PURPOSE"],
    [["leaf", "intermediate"], "root-not-a-ca", "INVALID_PURPOSE"],
    [["leaf", "intermediate"], "root-unknown-critical", "UNSPECIFIED"],
    [["self-signed-client-eku"], "self-signed-client-eku", "INVALID_PURPOSE"],
  ])("extensions are enforced: %p under %s", async (chain, ca, expected) => {
    expect(await connect(chain, { ca: pem([ca]) })).toBe(expected);
  });

  it.each([
    [["root"], ["root-empty", "intermediate-empty"], false, "authorized"],
    [["root"], ["root-empty", "intermediate-revokes-leaf"], false, "CERT_REVOKED"],
    [["root"], ["root-revokes-itself", "intermediate-empty"], false, "CERT_REVOKED"],
    [
      ["root"],
      ["root-empty", "intermediate-revokes-leaf", "intermediate-attribute-certificates"],
      false,
      "CERT_REVOKED",
    ],
    [["root", "intermediate", "leaf"], ["root-empty", "intermediate-revokes-leaf"], true, "UNABLE_TO_GET_CRL"],
    [["root", "intermediate"], ["root-revokes-intermediate", "intermediate-empty"], true, "UNABLE_TO_GET_CRL"],
    [["leaf"], ["intermediate-revokes-leaf"], true, "UNABLE_TO_GET_CRL"],
  ])("ca: %p, crl: %p, allowPartialTrustChain: %p", async (ca, crl, allowPartialTrustChain, expected) => {
    const options = { ca: pem(ca), crl: crls(crl), allowPartialTrustChain };
    expect(await connect(["leaf", "intermediate"], options)).toBe(expected);
  });

  // OpenSSL 3.6 stopped checking a self-signed anchor. Node.js bundles 3.5.
  it.each([
    ["self-signed-empty", "authorized"],
    ["root-empty", "UNABLE_TO_GET_CRL"],
    ["self-signed-revokes-itself", "CERT_REVOKED"],
    ["self-signed-expired", "CRL_HAS_EXPIRED"],
    ["self-signed-not-yet-valid", "CRL_NOT_YET_VALID"],
  ])("a pinned self-signed certificate with crl: %s", async (crl, expected) => {
    expect(await connect(["self-signed"], { ca: pem(["self-signed"]), crl: crls([crl]) })).toBe(expected);
  });

  it("allowPartialTrustChain does not shorten the chain a server completes from its `ca`", async () => {
    const serverOptions = { ca: pem(["leaf", "intermediate", "root"]), allowPartialTrustChain: true };
    expect(await connect(["leaf"], { ca: pem(["root"]) }, serverOptions)).toBe("authorized");
  });
});

describe("a certificate is accepted when any path to a trusted certificate is valid", () => {
  const tlv = (tag: number, ...body: Buffer[]) => {
    const { length } = Buffer.concat(body);
    const header = length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : [0x82, length >> 8, length & 0xff];
    return Buffer.concat([Buffer.from([tag, ...header]), ...body]);
  };
  const hex = (text: string) => Buffer.from(text, "hex");
  const seq = (...body: Buffer[]) => tlv(0x30, ...body);
  const oid = (text: string) => tlv(0x06, hex(text));
  const time = (year: number) => tlv(0x18, Buffer.from(`${year}0101000000Z`));
  const dn = (name: string) => seq(tlv(0x31, seq(oid("550403"), tlv(0x0c, Buffer.from(name)))));
  const extension = (id: string, value: Buffer, critical = true) =>
    seq(oid(id), hex(critical ? "0101ff" : ""), tlv(0x04, value));
  const armor = (label: string, der: Buffer) =>
    `-----BEGIN ${label}-----\n${der.toString("base64").replace(/.{64}(?!$)/g, "$&\n")}\n-----END ${label}-----\n`;
  const ecdsa = seq(oid("2a8648ce3d040302"));
  const signed = (tbs: Buffer, signer: KeyPair) =>
    seq(tbs, ecdsa, tlv(0x03, hex("00"), sign("sha256", tbs, signer.privateKey)));

  const [serverAuth, clientAuth, anyUse] = [oid("2b06010505070301"), oid("2b06010505070302"), oid("551d2500")];
  const keyCertSign = extension("551d0f", hex("03020106")); // and cRLSign
  const isCA = [extension("551d13", seq(hex("0101ff"))), keyCertSign];
  const notCA = extension("551d13", seq());
  const localhost = extension("551d11", seq(tlv(0x82, Buffer.from("localhost")), tlv(0x87, hex("7f000001"))), false);
  const keyId = (id: string) => extension("551d0e", tlv(0x04, hex(id)), false);
  const issuerKeyId = (id: string) => extension("551d23", seq(tlv(0x80, hex(id))), false);
  const onlyExampleCom = extension("551d1e", seq(tlv(0xa0, seq(tlv(0x82, Buffer.from("example.com"))))));

  const newKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const [rootKey, intKey, otherKey, leafKey] = [newKey(), newKey(), newKey(), newKey()];
  const key = leafKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  type Spec = { issuer: string; key: KeyPair; signer: KeyPair; extensions: Buffer[]; padding: number; valid: Buffer };
  let serial = 0x100;
  /** Usually without key identifiers, so that only the name tells who the issuer may be. */
  function mint(subject: string, { issuer, key, signer, extensions, padding, valid }: Spec) {
    const tbs = seq(
      hex("a003020102"),
      tlv(0x02, hex((serial++).toString(16).padStart(4, "0"))),
      ecdsa,
      dn(issuer),
      valid,
      dn(subject),
      key.publicKey.export({ type: "spki", format: "der" }),
      tlv(0xa3, seq(...extensions, extension("2a0305", Buffer.alloc(padding), false))),
    );
    return armor("CERTIFICATE", signed(tbs, signer));
  }
  const usual = { extensions: isCA, padding: 100, valid: seq(time(2020), time(2120)) };
  const expired = { valid: seq(time(2020), time(2021)) };
  const mintRoot = (spec?: Partial<Spec>) =>
    mint("root", { ...usual, issuer: "root", key: rootKey, signer: rootKey, ...spec });
  const mintInt = (spec?: Partial<Spec>) =>
    mint("int", { ...usual, issuer: "root", key: intKey, signer: rootKey, ...spec });
  const mintLeaf = (spec?: Partial<Spec>) =>
    mint("leaf", { ...usual, issuer: "int", key: leafKey, signer: intKey, extensions: [notCA, localhost], ...spec });
  const serialOf = (pem: string) => hex(new X509Certificate(pem).serialNumber);
  type CRLSpec = { revoked: string[]; until: number; extensions: Buffer[] };
  function crlOf(issuer: string, signer: KeyPair, { revoked = [], until = 2120, extensions }: Partial<CRLSpec> = {}) {
    const entries = revoked.map(pem => seq(tlv(0x02, serialOf(pem)), time(2020)));
    const rest = [entries.length ? seq(...entries) : hex(""), extensions ? tlv(0xa0, seq(...extensions)) : hex("")];
    return armor("X509 CRL", signed(seq(hex("020101"), ecdsa, dn(issuer), time(2020), time(until), ...rest), signer));
  }
  /** easy-rsa names the certificate of the issuer, so each renewal has CRLs of its own. */
  const issuerSerial = (pem: string) => [extension("551d23", seq(tlv(0x82, serialOf(pem))), false)];
  const withSettings = (pem: string, ...settings: Buffer[]) =>
    armor("TRUSTED CERTIFICATE", Buffer.concat([new X509Certificate(pem).raw, seq(...settings)]));
  const trusted = (pem: string, ...uses: Buffer[]) => withSettings(pem, seq(...uses));
  const distrusted = (pem: string, use = serverAuth) => withSettings(pem, tlv(0xa0, use));

  const [root, int, leaf] = [mintRoot(), mintInt(), mintLeaf()];
  const other = mint("other", { ...usual, issuer: "other", key: otherKey, signer: otherKey });
  const [rootCRL, intCRL] = [crlOf("root", rootKey), crlOf("int", intKey)];
  const byOther = { issuer: "other", signer: otherKey };
  const rootByOther = mintRoot(byOther);
  const shortNotCA = mintRoot({ extensions: [notCA, keyCertSign], padding: 1 });
  const shortOtherKey = mintRoot({ key: otherKey, signer: otherKey, padding: 1 });
  const digitalSignature = extension("551d0f", hex("03020780"));
  const selfSigned = mintLeaf({ issuer: "leaf", signer: leafKey, extensions: [notCA, digitalSignature, localhost] });
  // BoringSSL does not hold this common name against name constraints, because there is a subjectAltName. Bun does.
  const onlyAnAddress = extension("551d11", seq(tlv(0x87, hex("7f000001"))), false);
  const namedByCN = mint("bun.test", {
    ...usual,
    issuer: "int",
    key: leafKey,
    signer: intKey,
    extensions: [onlyAnAddress],
  });
  const encodedAs = (spki: Buffer) => ({ publicKey: { export: () => spki } }) as any as KeyPair;
  const unknownKey = encodedAs(seq(seq(oid("2a0306")), tlv(0x03, hex("0001"))));
  const rogueInt = mintInt({ ...byOther, key: leafKey });
  const rogueLeaf = mintLeaf({ signer: leafKey });
  const [renewedInt, renewedRoot] = [mintInt(), mintRoot({ padding: 1 })];
  const leafAsRoot = [100, 1].map(padding =>
    mint("leaf", { ...usual, issuer: "leaf", key: leafKey, signer: leafKey, padding }),
  );
  // A rollover: the root gets a new key and keeps its name. The link lets those who know the old key trust the new one.
  const oldRoot = mintRoot({ extensions: [...isCA, keyId("01")] });
  const newRoot = mintRoot({ key: otherKey, signer: otherKey, extensions: [...isCA, keyId("02")] });
  const link = mintRoot({ key: otherKey, extensions: [...isCA, keyId("02"), issuerKeyId("01")] });
  const byNewRoot = mintLeaf({ issuer: "root", signer: otherKey, extensions: [notCA, localhost, issuerKeyId("02")] });
  const oldRootCRL = crlOf("root", rootKey, { extensions: [issuerKeyId("01")] });
  const constrained = () => mintRoot({ extensions: [...isCA, onlyExampleCom], padding: 1 });
  const anyName = { checkServerIdentity: () => undefined };
  const loop = (one: KeyPair, another: KeyPair) => [
    mintInt({ issuer: "loop", key: one }),
    mint("loop", { ...usual, issuer: "int", key: another, signer: otherKey }),
  ];
  // Two signatures each: its own on the leaf, and the root's on it. `int` takes those, and both again with all the rest.
  const decoys = Array.from({ length: 48 }, () => mintInt({ key: otherKey, signer: otherKey }));
  const deadEnd = mintInt({ issuer: "unknown" });
  const inPlaceOfADecoy = (spec: Partial<Spec>) => [leaf, ...decoys.slice(1), mintInt(spec), deadEnd, int];
  const constrainedInt = mintInt({ extensions: [...isCA, onlyExampleCom] });
  const leafThatIsCA = mintLeaf({ extensions: [isCA[0], localhost] });
  const selfIssued = mintLeaf({ issuer: "leaf", extensions: [notCA, digitalSignature, localhost] });
  const twin = mintLeaf({ issuer: "leaf", signer: leafKey, extensions: [...isCA, onlyExampleCom] });
  const issuedByTwin = mintLeaf({
    issuer: "leaf",
    signer: leafKey,
    extensions: [notCA, digitalSignature, localhost, ...issuerSerial(twin)],
  });

  /** In TLS 1.3 they go out with the first write. */
  const sendTickets = (socket: TLSSocket) =>
    socket
      .resume()
      .on("error", () => {})
      .write("!");
  const servers = new Map<string, Promise<Server>>();
  afterAll(async () => {
    for (const server of servers.values()) (await server).close();
  });
  async function portOf(chain: string[]) {
    const cert = chain.join("");
    if (!servers.has(cert)) {
      const server = tls.createServer({ key, cert }, sendTickets);
      servers.set(
        cert,
        once(server.listen(0, "127.0.0.1"), "listening").then(() => server),
      );
    }
    return ((await servers.get(cert)!).address() as AddressInfo).port;
  }
  async function connect(chain: string[], options: tls.ConnectionOptions) {
    const socket = tls.connect({ host: "127.0.0.1", port: await portOf(chain), servername: "localhost", ...options });
    const outcome = await once(socket, "secureConnect").then(
      () => "authorized",
      err => err.code,
    );
    socket.destroy();
    return outcome;
  }
  const bothOrders = (a: string, b: string) => [
    [a, b],
    [b, a],
  ];

  // [what is wrong with the copy, how, its code as the only root, its code as the only intermediate]
  describe.each([
    ["is not a CA", { extensions: [notCA, keyCertSign] }, "INVALID_PURPOSE", "INVALID_PURPOSE"],
    [
      "is for clients",
      { extensions: [...isCA, extension("551d25", seq(clientAuth))] },
      "INVALID_PURPOSE",
      "INVALID_PURPOSE",
    ],
    [
      "has an unknown critical extension",
      { extensions: [...isCA, extension("2a0304", hex("0500"))] },
      "UNSPECIFIED",
      "UNSPECIFIED",
    ],
    ["does not permit the name", { extensions: [...isCA, onlyExampleCom] }, "UNSPECIFIED", "UNSPECIFIED"],
    ["has another key", { key: leafKey }, "CERT_SIGNATURE_FAILURE", "CERT_SIGNATURE_FAILURE"],
    [
      "has another type of key",
      { key: generateKeyPairSync("ed25519") },
      "CERT_SIGNATURE_FAILURE",
      "CERT_SIGNATURE_FAILURE",
    ],
    [
      "has an unknown type of key",
      { key: unknownKey },
      "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
      "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
    ],
    ["has an unknown issuer", byOther, "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT"],
  ] as [string, Partial<Spec>, string, string][])("next to a copy that %s", (_, spec, asRoot, asInt) => {
    const accepted = ["authorized", "authorized", "authorized", "authorized"];
    const inEveryWay = (good: string, mintCopy: typeof mintRoot) =>
      [1, 200].flatMap(padding => bothOrders(good, mintCopy({ ...spec, padding })));

    it("a root in `ca`", async () => {
      expect(await connect([leaf, int], { ca: mintRoot(spec) })).toBe(asRoot);
      expect(await Promise.all(inEveryWay(root, mintRoot).map(ca => connect([leaf, int], { ca })))).toEqual(accepted);
    });

    it("an intermediate in `ca`", async () => {
      expect(await connect([leaf], { ca: [root, mintInt(spec)] })).toBe(asInt);
      const outcomes = inEveryWay(int, mintInt).map(ca => connect([leaf], { ca: [root, ...ca] }));
      expect(await Promise.all(outcomes)).toEqual(accepted);
    });

    it("an intermediate from the server", async () => {
      const unknownIssuer = spec === byOther;
      expect(await connect([leaf, mintInt(spec)], { ca: root })).toBe(unknownIssuer ? `${asInt}_LOCALLY` : asInt);
      const outcomes = bothOrders(int, mintInt(spec)).map(sent => connect([leaf, ...sent], { ca: root }));
      outcomes.push(connect([leaf, int], { ca: [root, mintInt(spec)] }));
      expect(await Promise.all(outcomes)).toEqual(["authorized", "authorized", "authorized"]);
    });
  });

  it.each([
    ["copies at both levels", [leaf], { ca: [shortNotCA, mintInt({ extensions: [notCA], padding: 1 }), root, int] }],
    ["from `ca` to what the server sent and back", [leaf, rootByOther], { ca: [int, other] }],
    [
      "a revoked copy",
      [leaf],
      { ca: [root, int, mintInt({ padding: 200 })], crl: [crlOf("root", rootKey, { revoked: [int] }), intCRL] },
    ],
    [
      "an unusable copy in `ca`, and an unknown type of key from the server",
      [leaf, mintInt({ key: unknownKey }), int],
      { ca: [root, mintInt({ extensions: [notCA, keyCertSign] })] },
    ],
    [
      "a self-signed leaf that may not sign certificates",
      [selfSigned],
      { ca: [mintLeaf({ issuer: "leaf" }), selfSigned] },
    ],
    [
      "...or that has the name and key of a root",
      [selfSigned],
      { ca: [mintLeaf({ issuer: "leaf", extensions: [notCA, keyCertSign], padding: 1 }), leafAsRoot[0]] },
    ],
    ["a common name that one copy does not permit", [namedByCN, int], { ca: [constrained(), root], ...anyName }],
    [
      "a path listed after loops",
      [leaf, ...Array.from({ length: 5 }, () => loop(intKey, rootKey)).flat(), int],
      { ca: root },
    ],
    [
      "a path listed after unknown roots",
      [leaf, int, ...Array.from({ length: 5 }, newKey).map(key => mintRoot({ key, signer: key })), mintInt(byOther)],
      { ca: other },
    ],
    [
      "one name twice, with two keys",
      [
        leaf,
        mintInt({ issuer: "int", signer: otherKey, extensions: [...isCA, keyId("01"), issuerKeyId("02")] }),
        mintInt({ key: otherKey, extensions: [...isCA, keyId("02")] }),
      ],
      { ca: [shortNotCA, root] },
    ],
    [
      "one key twice, with two names",
      [
        leaf,
        mintInt({ issuer: "alias", signer: intKey }),
        mint("alias", { ...usual, issuer: "root", key: intKey, signer: rootKey }),
      ],
      { ca: [shortNotCA, root] },
    ],
    ["100 signatures to check", [leaf, ...decoys, int], { ca: root }],
    ["...with a large certificate", inPlaceOfADecoy({ issuer: "unknown", padding: 3500 }), { ca: root }],
    ["...with a certificate that may not sign", inPlaceOfADecoy({ extensions: [digitalSignature] }), { ca: root }],
    [
      "a pinned leaf after more than that",
      [leaf, ...decoys, ...decoys.slice(0, 3)],
      { ca: [leaf, root], allowPartialTrustChain: true },
    ],
    ...[expired, { valid: seq(time(2119), time(2120)) }].map(outOfDate => [
      "a path listed after many copies that are out of date",
      [leaf, int],
      { ca: [shortNotCA, root, ...Array.from({ length: 13 }, () => mintInt(outOfDate))] },
    ]),
    [
      "a root after 100 of that name that the key identifier rules out",
      [leaf, mintInt({ extensions: [...isCA, issuerKeyId("01")] })],
      {
        ca: [
          ...Array.from({ length: 100 }, () => mintRoot({ extensions: [...isCA, keyId("02")], padding: 1 })),
          shortNotCA,
          oldRoot,
        ],
      },
    ],
  ] as [string, string[], tls.ConnectionOptions][])("accepts %s", async (_, chain, options) => {
    expect(await connect(chain, options)).toBe("authorized");
  });

  it.each([
    ["two unusable copies", [leaf, int], { ca: [shortNotCA, rootByOther] }, "INVALID_PURPOSE"],
    ["...in the other order", [leaf, int], { ca: [rootByOther, shortNotCA] }, "INVALID_PURPOSE"],
    ["an expired leaf", [mintLeaf(expired), int], { ca: [root, mintRoot()] }, "CERT_HAS_EXPIRED"],
    [
      "a leaf for clients",
      [mintLeaf({ extensions: [notCA, localhost, extension("551d25", seq(clientAuth))] }), int],
      { ca: [root, mintRoot()] },
      "INVALID_PURPOSE",
    ],
    ["a forged leaf", [mintLeaf({ signer: otherKey }), int], { ca: [root, mintRoot()] }, "CERT_SIGNATURE_FAILURE"],
    [
      "a revoked leaf",
      [leaf, int],
      { ca: [root, mintRoot()], crl: [rootCRL, crlOf("int", intKey, { revoked: [leaf] })] },
      "CERT_REVOKED",
    ],
    [
      "a revoked leaf, through a certificate of its issuer that has an older CRL",
      [leaf, int],
      {
        ca: [root, renewedInt],
        crl: [
          rootCRL,
          crlOf("int", intKey, { extensions: issuerSerial(int) }),
          crlOf("int", intKey, { extensions: issuerSerial(renewedInt), revoked: [leaf] }),
        ],
      },
      "CERT_REVOKED",
    ],
    [
      "a revoked intermediate, likewise",
      [leaf, int],
      {
        ca: [root, renewedRoot],
        crl: [
          intCRL,
          crlOf("root", rootKey, { extensions: issuerSerial(root) }),
          crlOf("root", rootKey, { extensions: issuerSerial(renewedRoot), revoked: [int] }),
        ],
      },
      "CERT_REVOKED",
    ],
    [
      "a revoked root, likewise",
      [selfSigned],
      {
        ca: leafAsRoot,
        crl: [
          crlOf("leaf", leafKey, { extensions: issuerSerial(leafAsRoot[0]) }),
          crlOf("leaf", leafKey, { extensions: issuerSerial(leafAsRoot[1]), revoked: leafAsRoot }),
        ],
      },
      "CERT_REVOKED",
    ],
    [
      "the server's copy of an intermediate that is revoked in `ca`",
      [leaf, renewedInt],
      { ca: [root, int], crl: [crlOf("root", rootKey, { revoked: [int] }), intCRL] },
      "CERT_REVOKED",
    ],
    [
      "a cross-signed copy of a root that revokes itself",
      [leaf, int, rootByOther],
      { ca: [root, other], crl: [crlOf("root", rootKey, { revoked: [root] }), intCRL, crlOf("other", otherKey)] },
      "CERT_REVOKED",
    ],
    [
      "the CRL of the old key in place of one that is out of date",
      [byNewRoot, link],
      {
        ca: [oldRoot, newRoot],
        crl: [oldRootCRL, crlOf("root", otherKey, { extensions: [issuerKeyId("02")], until: 2021 })],
      },
      "CRL_HAS_EXPIRED",
    ],
    ["...or missing", [byNewRoot, link], { ca: [oldRoot, newRoot], crl: oldRootCRL }, "UNABLE_TO_GET_CRL"],
    [
      "a pinned leaf that its issuer does not permit",
      [leaf],
      { ca: [leaf, constrainedInt], allowPartialTrustChain: true },
      "UNSPECIFIED",
    ],
    [
      "...and that has issued a copy of it",
      [leafThatIsCA, mintInt({ issuer: "leaf", signer: leafKey })],
      { ca: [leafThatIsCA, constrainedInt], allowPartialTrustChain: true },
      "UNSPECIFIED",
    ],
    [
      "...whose type of key is unknown",
      [leaf],
      { ca: [leaf, mintInt({ key: unknownKey, extensions: [...isCA, onlyExampleCom] })], allowPartialTrustChain: true },
      "UNSPECIFIED",
    ],
    [
      "...whose key it has",
      [rogueLeaf],
      {
        ca: [rogueLeaf, mintInt({ key: leafKey, extensions: [...isCA, onlyExampleCom] })],
        allowPartialTrustChain: true,
      },
      "UNSPECIFIED",
    ],
    ["...whose name and key it has", [issuedByTwin], { ca: [issuedByTwin, twin] }, "UNSPECIFIED"],
    [
      "...whose name it has, by way of an intermediate without its root",
      [selfIssued, mint("leaf", { ...usual, issuer: "root", key: intKey, signer: rootKey })],
      {
        ca: [
          selfIssued,
          mint("leaf", {
            ...usual,
            issuer: "leaf",
            key: intKey,
            signer: intKey,
            extensions: [...isCA, onlyExampleCom],
          }),
          rootByOther,
        ],
      },
      "UNSPECIFIED",
    ],
    ["a root that only the server sent", [leaf, int, root], { ca: shortNotCA }, "INVALID_PURPOSE"],
    ["intermediates without their root", [leaf], { ca: [int, mintInt()] }, "UNABLE_TO_GET_ISSUER_CERT"],
    [
      "the wrong host",
      [leaf, int],
      { ca: [shortNotCA, root], servername: "example.com" },
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ],
    ["101 signatures to check", [leaf, ...decoys, deadEnd, int], { ca: root }, "CERT_SIGNATURE_FAILURE"],
    [
      "...counting a certificate that may not sign",
      [leaf, ...decoys, mintInt({ extensions: [digitalSignature] }), int],
      { ca: root },
      "CERT_SIGNATURE_FAILURE",
    ],
    [
      "...and a very large one twice",
      inPlaceOfADecoy({ issuer: "unknown", padding: 4096 }),
      { ca: root },
      "CERT_SIGNATURE_FAILURE",
    ],
    [
      "a common name that no copy permits",
      [namedByCN, int],
      { ca: [constrained(), constrained()], ...anyName },
      "UNSPECIFIED",
    ],
    [
      "10! * 10! dead ends",
      [leaf, ...Array.from({ length: 10 }, () => loop(newKey(), newKey())).flat()],
      { ca: root },
      "CERT_SIGNATURE_FAILURE",
    ],
  ] as [string, string[], tls.ConnectionOptions, string][])("refuses %s", async (_, chain, options, code) => {
    expect(await connect(chain, options)).toBe(code);
  });

  const crossSigned = [leaf, int, rootByOther];
  const point = intKey.publicKey.export({ type: "spki", format: "der" }).subarray(-65);
  const compressed = ECDH.convertKey(point, "prime256v1", undefined, undefined, "compressed") as Buffer;
  const hybrid = Buffer.concat([Buffer.from([compressed[0] | 4]), point.subarray(1)]);
  const p256 = seq(oid("2a8648ce3d0201"), oid("2a8648ce3d030107"));
  const [compressedIntKey, hybridIntKey] = [compressed, hybrid].map(point =>
    encodedAs(seq(p256, tlv(0x03, hex("00"), point))),
  );
  it.each([
    ["distrusts nothing", [leaf, int], [root], "authorized"],
    ["distrusts the leaf", [leaf, int], [distrusted(leaf), root], "CERT_REJECTED"],
    ["distrusts the intermediate", [leaf, int], [distrusted(int), root], "CERT_REJECTED"],
    ["...and the server has another copy", [leaf, mintInt()], [distrusted(int), root], "CERT_REJECTED"],
    [
      "...with the key compressed",
      [leaf, mintInt({ key: compressedIntKey })],
      [distrusted(int), root],
      "CERT_REJECTED",
    ],
    [
      "...with the key in a form that cannot be read",
      [leaf, int],
      [distrusted(mintInt({ key: hybridIntKey })), root],
      "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
    ],
    [
      "...and lists another copy first",
      [leaf, rootByOther],
      [mintInt(), distrusted(int), other],
      "UNABLE_TO_GET_ISSUER_CERT",
    ],
    ["distrusts a cross-signed root", crossSigned, [distrusted(root), other], "UNABLE_TO_GET_ISSUER_CERT"],
    ["...for any use", crossSigned, [distrusted(root, anyUse), other], "UNABLE_TO_GET_ISSUER_CERT"],
    ["...for another use", crossSigned, [distrusted(root, clientAuth), other], "authorized"],
    ["trusts it for another use", crossSigned, [trusted(root, clientAuth), other], "UNABLE_TO_GET_ISSUER_CERT"],
    ["trusts an intermediate for any use", [leaf, rootByOther], [trusted(int, anyUse), other], "authorized"],
    [
      "trusts one copy of the root for another use, and one for this",
      [leaf, int],
      [trusted(root, clientAuth), trusted(renewedRoot, serverAuth), other],
      "authorized",
    ],
    [
      "trusts an intermediate for another use",
      [leaf, rootByOther],
      [trusted(int, clientAuth), other],
      "UNABLE_TO_GET_ISSUER_CERT",
    ],
    ["trusts it for no use", crossSigned, [trusted(root), other], "UNABLE_TO_GET_ISSUER_CERT"],
    ["trusts an unusable copy of it", crossSigned, [trusted(shortNotCA, serverAuth), other], "authorized"],
    [
      "gives an intermediate a friendly name",
      [leaf, rootByOther],
      [withSettings(int, tlv(0x0c, Buffer.from("int"))), other],
      "authorized",
    ],
    ["distrusts another key of that name", [leaf, int], [distrusted(shortOtherKey), root], "authorized"],
    ["distrusts a root that a path avoids", [leaf, int, mintInt(byOther)], [distrusted(root), other], "authorized"],
    [
      "distrusts the issuer of a pinned leaf",
      [selfIssued],
      [distrusted(mint("leaf", { ...usual, issuer: "leaf", key: intKey, signer: intKey })), selfIssued],
      "CERT_REJECTED",
    ],
    [
      "has a CRL, which takes `crl` to count",
      [leaf, int],
      [shortNotCA, root, crlOf("int", intKey, { revoked: [leaf] })],
      "authorized",
    ],
  ])("caFile %s", async (_, chain, file, expected) => {
    using dir = tempDir("distrust", { "ca.pem": file.join("") });
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    using socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: await portOf(chain),
      tls: {
        caFile: join(String(dir), "ca.pem"),
        serverName: "localhost",
        rejectUnauthorized: false,
      } as Bun.TLSOptions,
      socket: {
        data() {},
        handshake: (_, __, error) => resolve((error as NodeJS.ErrnoException | null)?.code ?? "authorized"),
        error: (_, error) => reject(error),
        close: () => reject(new Error("closed before the handshake")),
      },
    });
    expect(await promise).toBe(expected);
  });

  it.each([
    ["clients", clientAuth, "UNABLE_TO_GET_ISSUER_CERT"],
    ["servers", serverAuth, "authorized"],
  ])("the caFile of a server distrusts a cross-signed root for %s", async (_, use, expected) => {
    using dir = tempDir("distrust", { "ca.pem": distrusted(root, use) + other });
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: {
        ...harnessCert,
        caFile: join(String(dir), "ca.pem"),
        requestCert: true,
        rejectUnauthorized: false,
      } as Bun.TLSOptions,
      socket: {
        data() {},
        handshake: (_, __, error) => resolve((error as NodeJS.ErrnoException | null)?.code ?? "authorized"),
        error: (_, error) => reject(error),
      },
    });
    const cert = crossSigned.join("");
    const client = tls.connect({ host: "127.0.0.1", port: server.port, key, cert, rejectUnauthorized: false });
    client.once("error", reject);
    try {
      expect(await promise).toBe(expected);
    } finally {
      client.destroy();
    }
  });

  describe.each(bothOrders(root, shortOtherKey).map((ca, i) => [i ? "last" : "first", ca] as const))(
    "with the right root %s",
    (_, ca) => {
      it("one string, many other roots, addCACert", async () => {
        const secureContext = tls.createSecureContext();
        for (const pem of ca) secureContext.context.addCACert(pem);
        const ways = [{ ca: ca.join("") }, { secureContext }];
        for (const at of [0, 15, 30]) {
          ways.push({ ca: [...tls.rootCertificates.slice(0, 30).toSpliced(at, 0, ca[0]), ca[1]].join("\n") });
        }
        const outcomes = await Promise.all(ways.map(options => connect([leaf, int], options)));
        expect(outcomes).toEqual(ways.map(() => "authorized"));
      });

      it("over a Duplex", async () => {
        const transport = net.connect(await portOf([leaf, int]), "127.0.0.1");
        const socket = new Duplex({
          read() {},
          write: (chunk, encoding, callback) => void transport.write(chunk, encoding, callback),
        });
        transport
          .on("data", chunk => socket.push(chunk))
          .on("error", error => socket.destroy(error))
          .on("close", () => socket.push(null));
        try {
          expect(await connect([leaf, int], { ca, socket })).toBe("authorized");
        } finally {
          transport.destroy();
        }
      });

      it("the certificate of a client", async () => {
        await using server = tls.createServer({ ...harnessCert, ca, requestCert: true, rejectUnauthorized: true });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const { promise, resolve, reject } = Promise.withResolvers<TLSSocket>();
        server.once("secureConnection", resolve).once("tlsClientError", reject);
        const port = (server.address() as AddressInfo).port;
        const client = tls.connect({ host: "127.0.0.1", port, key, cert: leaf + int, rejectUnauthorized: false });
        client.once("error", reject);
        try {
          expect((await promise).authorized).toBe(true);
        } finally {
          client.destroy();
        }
      });

      it("fetch with `ca`, and with NODE_EXTRA_CA_CERTS over TCP and QUIC", async () => {
        using dir = tempDir("extra-ca", { "ca.pem": ca.join("") });
        using server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          tls: { key, cert: leaf + int },
          http3: true,
          fetch: () => new Response("authorized"),
        });
        expect(await fetch(server.url, { tls: { ca } }).then(response => response.text())).toBe("authorized");
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `for (const protocol of ["http1.1", "http3"]) {
              console.log(await fetch(process.env.URL, { protocol }).then(r => r.text(), e => e.code));
            }`,
          ],
          env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "ca.pem"), URL: server.url.href },
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "authorized\nauthorized\n", stderr: "", exitCode: 0 });
      });
    },
  );

  it("the errors of a dead end do not fail a QUIC handshake whose Finished is in the next packet", async () => {
    // The sizes cover a packet in steps shorter than Finished.
    const leaves = Array.from({ length: 40 }, (_, i) => mintLeaf({ issuer: "root", signer: rootKey, padding: i * 30 }));
    using dir = tempDir("quic-dead-end", { "ca.pem": shortOtherKey + root, "leaves.json": JSON.stringify(leaves) });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const outcomes = await Promise.all(require("./leaves.json").map(async cert => {
          const tls = { key: process.env.KEY, cert };
          using server = Bun.serve({ hostname: "127.0.0.1", port: 0, http3: true, tls, fetch: () => new Response("ok") });
          return await fetch(server.url, { protocol: "http3" }).then(r => r.text(), e => e.code);
        }));
        console.log(outcomes.length, ...new Set(outcomes));`,
      ],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "ca.pem"), KEY: key },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "40 ok\n", stderr: "", exitCode: 0 });
  });

  /** What `side` makes of `chain`, and then again with the session of that connection. */
  async function seenBy(
    side: "client" | "server",
    maxVersion: tls.SecureVersion,
    chain: string[],
    trust: tls.ConnectionOptions,
    trustOfResumingClient = trust,
  ) {
    const identity = { key, cert: chain.join("") };
    await using server = tls.createServer(
      side === "client" ? identity : { ...harnessCert, ...trust, requestCert: true, rejectUnauthorized: false },
      sendTickets,
    );
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const seen = [];
    let session: Buffer | undefined;
    for (const event of ["session", "secureConnect"]) {
      const options = side === "server" ? identity : session ? trustOfResumingClient : trust;
      const client = tls.connect({
        host: "127.0.0.1",
        port,
        maxVersion,
        session,
        rejectUnauthorized: false,
        ...options,
      });
      try {
        const [[accepted], [arg]] = await Promise.all([once(server, "secureConnection"), once(client, event)]);
        const socket: TLSSocket = side === "client" ? client : accepted;
        const serials = [];
        for (let cert = socket.getPeerCertificate(true), last; cert && serials.at(-1) !== "itself";) {
          serials.push(cert === last ? "itself" : cert.serialNumber);
          [last, cert] = [cert, cert.issuerCertificate];
        }
        seen.push({ error: socket.authorizationError ?? null, resumed: socket.isSessionReused(), serials });
        session ??= arg as Buffer;
      } finally {
        client.destroy();
      }
    }
    return seen;
  }

  const serialsOf = (chain: string[]) =>
    chain.map(pem => (pem === "itself" ? pem : new X509Certificate(pem).serialNumber));
  const revokedInt = mintInt(byOther);
  const forgedInt = mintInt({ issuer: "other", signer: leafKey });
  const both = { ca: [root, other] };
  const usualPath = [leaf, int, root, "itself"];
  // Applications pin this chain. [name, what the peer sends, what is trusted, the chain]
  it.each([
    ["an ordinary chain", [leaf, int], both, usualPath],
    ["a cross-signed root", [leaf, int, rootByOther], both, [leaf, int, rootByOther, other, "itself"]],
    ["a forged copy", [leaf, forgedInt, int, mintInt(byOther)], both, usualPath],
    ["an expired copy", [leaf, mintInt({ ...byOther, ...expired }), int], both, usualPath],
    [
      "a copy that does not permit the name",
      [leaf, mintInt({ ...byOther, extensions: [...isCA, onlyExampleCom] }), int],
      both,
      usualPath,
    ],
    [
      "a revoked copy",
      [leaf, revokedInt, int],
      { ...both, crl: [crlOf("other", otherKey, { revoked: [revokedInt] }), rootCRL, intCRL] },
      usualPath,
    ],
    ["a CA that did not sign", [rogueLeaf, int, rogueInt], both, [rogueLeaf, rogueInt, other, "itself"]],
    ["...and is in `ca`", [rogueLeaf, rogueInt], { ca: [int, root, other] }, [rogueLeaf, rogueInt, other, "itself"]],
    ["two roots in `ca`", [leaf, int], { ca: [shortOtherKey, root] }, usualPath],
    [
      "from `ca` to what the peer sent and back",
      [leaf, rootByOther],
      { ca: [int, other] },
      [leaf, int, rootByOther, other, "itself"],
    ],
    [
      "a forged issuer of a self-signed leaf",
      [selfSigned, mint("leaf", { ...usual, issuer: "root", key: leafKey, signer: leafKey })],
      { ca: [root, selfSigned] },
      [selfSigned],
    ],
    [
      "a pinned leaf that names a CA from the peer",
      [rogueLeaf, int],
      { ca: [rogueLeaf, root], allowPartialTrustChain: true },
      [rogueLeaf],
    ],
    [
      "a pinned leaf whose issuer has expired",
      [leaf, decoys[0]],
      { ca: [leaf, mintInt(expired), root], allowPartialTrustChain: true },
      [leaf],
    ],
    [
      "a pinned leaf that has a path as well",
      [leaf, int],
      { ca: [leaf, shortOtherKey, root], allowPartialTrustChain: true },
      usualPath,
    ],
    [
      "a partial chain",
      [leaf],
      { ca: [mintInt({ key: leafKey, padding: 1 }), int, shortNotCA], allowPartialTrustChain: true },
      [leaf, int],
    ],
    [
      "...that has a root after all",
      [leaf],
      { ca: [mintInt({ key: leafKey, padding: 1 }), int, root], allowPartialTrustChain: true },
      usualPath,
    ],
    [
      "a longer partial chain",
      [leaf, decoys[0], int],
      { ca: rootByOther, allowPartialTrustChain: true },
      [leaf, int, rootByOther],
    ],
  ] as [string, string[], tls.SecureContextOptions, string[]][])(
    "getPeerCertificate(true) with %s",
    async (_, chain, trust, expected) => {
      const serials = serialsOf(expected);
      const outcomes = (["client", "server"] as const).flatMap(side =>
        (["TLSv1.2", "TLSv1.3"] as const).map(version => seenBy(side, version, chain, trust)),
      );
      expect(await Promise.all(outcomes)).toEqual(
        outcomes.map(() => [
          { error: null, resumed: false, serials },
          { error: null, resumed: true, serials },
        ]),
      );
    },
  );

  it.each([
    ["client", clientAuth],
    ["server", serverAuth],
  ] as const)("getPeerCertificate(true) on a %s, with a copy that is for the likes of it", async (side, use) => {
    const copy = mintInt({ ...byOther, extensions: [...isCA, extension("551d25", seq(use))] });
    expect(await seenBy(side, "TLSv1.3", [leaf, copy, int], both)).toEqual([
      { error: null, resumed: false, serials: serialsOf(usualPath) },
      { error: null, resumed: true, serials: serialsOf(usualPath) },
    ]);
  });

  it.each([
    ["client", serverAuth],
    ["server", clientAuth],
  ] as const)(
    "getPeerCertificate(true) on a %s, with a pinned leaf that makes the chain partial",
    async (side, use) => {
      const extensions = [notCA, digitalSignature, localhost, extension("551d25", seq(use))];
      const pinned = mintLeaf({ issuer: "leaf", extensions });
      const [issuer, namesake] = [intKey, otherKey].map((key, i) =>
        mint("leaf", { ...usual, issuer: "root", key, signer: rootKey, padding: i ? 1 : 100 }),
      );
      expect(await seenBy(side, "TLSv1.3", [pinned], { ca: [pinned, issuer, namesake] })).toEqual([
        { error: null, resumed: false, serials: serialsOf([pinned, issuer]) },
        { error: null, resumed: true, serials: serialsOf([pinned, issuer]) },
      ]);
    },
  );

  async function bunConnect(chain: string[], options: object, open?: (socket: Bun.Socket) => void) {
    const { promise, resolve, reject } = Promise.withResolvers<Bun.Socket>();
    await Bun.connect({
      hostname: "127.0.0.1",
      port: await portOf(chain),
      tls: options,
      socket: {
        data() {},
        open,
        handshake: resolve,
        error: (_, error) => reject(error),
        close: () => reject(new Error("closed before the handshake")),
      },
    });
    return await promise;
  }
  const issuerSeenBy = (socket: Bun.Socket) =>
    (socket.getPeerCertificate(false) as tls.DetailedPeerCertificate).issuerCertificate.serialNumber;

  it("Bun.connect stays with the path of the handshake", async () => {
    const { context } = tls.createSecureContext({ ca: root });
    using socket = await bunConnect([leaf, decoys[0], mintInt(byOther), int], { secureContext: context });
    context.addCACert(other);
    expect([socket.getAuthorizationError(), issuerSeenBy(socket)]).toEqual([null, ...serialsOf([int])]);
  });

  it("a client keeps its certificate from a server that has the wrong name", async () => {
    // In TLS 1.2 the certificate goes out before the handshake is over for the client.
    await using server = tls.createServer({
      key,
      cert: leaf + int,
      maxVersion: "TLSv1.2",
      requestCert: true,
      rejectUnauthorized: false,
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { promise, resolve } = Promise.withResolvers<string>();
    for (const event of ["secureConnection", "tlsClientError"]) server.once(event, () => resolve(event));
    const { port } = server.address() as AddressInfo;
    const options = { host: "127.0.0.1", port, servername: "example.com", ca: [shortNotCA, root], ...harnessCert };
    const [error] = await once(tls.connect(options), "error");
    expect([error.code, await promise]).toEqual(["ERR_TLS_CERT_ALTNAME_INVALID", "tlsClientError"]);
  });

  it("getPeerCertificate(true) with a forged copy and the wrong name", async () => {
    const error = "ERR_TLS_CERT_ALTNAME_INVALID";
    expect(await seenBy("client", "TLSv1.3", [leaf, forgedInt, int], { ...both, servername: "example.com" })).toEqual([
      { error, resumed: false, serials: serialsOf(usualPath) },
      { error, resumed: true, serials: serialsOf(usualPath) },
    ]);
    const port = await portOf([leaf, forgedInt, int]);
    const [{ code, cert }] = await once(
      tls.connect({ host: "127.0.0.1", port, ...both, servername: "example.com" }),
      "error",
    );
    expect([code, cert.issuerCertificate.serialNumber]).toEqual([error, ...serialsOf([int])]);
  });

  const forgedRoot = mintRoot({ issuer: "other", signer: leafKey });
  it.each([
    ["no path is valid", { ca: other }, "CERT_SIGNATURE_FAILURE", [leaf, int, forgedRoot, other, "itself"]],
    ["the first path is valid", both, null, usualPath],
  ])("a session that is resumed where %s", async (_, trust, error, expected) => {
    expect(await seenBy("client", "TLSv1.3", [leaf, int, forgedRoot], { ca: [shortNotCA, root] }, trust)).toEqual([
      { error: null, resumed: false, serials: serialsOf(usualPath) },
      { error, resumed: true, serials: serialsOf(expected) },
    ]);
  });

  async function sessionOf(chain: string[], options: tls.ConnectionOptions) {
    const socket = tls.connect({ host: "127.0.0.1", port: await portOf(chain), ...options });
    const [session] = await once(socket, "session");
    socket.destroy();
    return session as Buffer;
  }

  it.each([
    [[leaf, int], shortNotCA, "INVALID_PURPOSE"],
    [[namedByCN, int], constrained(), "UNSPECIFIED"],
  ])("a session that is resumed where no path is valid, by a client that rejects (%#)", async (chain, ca, code) => {
    const session = await sessionOf(chain, { ca: [ca, root] });
    expect(await connect(chain, { ca, session, ...anyName })).toBe(code);
  });

  // Any other session outlasts its certificates. [name, year of the handshake, first year of the root, last one]
  const thisYear = new Date().getUTCFullYear();
  it.each([
    ["the root has expired since", -2, -2, -2, "authorized"],
    ["the root was renewed since", -2, -1, 1, "authorized"],
    ["the clock went back since, from beyond 2038", 13, 13, 13, "authorized"],
    ["the root is valid neither then nor now", -3, -2, -2, "INVALID_PURPOSE"],
  ])("a session that is resumed when %s", async (_, handshake, from, until, expected) => {
    const session = await sessionOf([leaf, int], { ca: [shortNotCA, root] });
    // verifyResult [5] INTEGER, as us_cert_verify_cb sets it.
    const resultAt = (ms: number) => 2 ** 30 + (Math.floor(ms / 1000) % 2 ** 30);
    const offset = session.indexOf(hex("a5060204")) + 4;
    expect(resultAt(Date.now()) - session.readUInt32BE(offset)).toBeWithin(0, 60);
    session.writeUInt32BE(resultAt(Date.UTC(thisYear + handshake, 6)), offset);
    const ca = [shortNotCA, mintRoot({ valid: seq(time(thisYear + from), time(thisYear + until + 1)) })];
    expect(await connect([leaf, int], { ca, session })).toBe(expected);
  });

  it("a session that is refused when it is resumed stays refused", async () => {
    await using server = Bun.spawn({
      cmd: ["node", join(import.meta.dir, "renegotiation-feature.js")],
      env: { ...bunEnv, SERVER_CERT: leaf + int, SERVER_KEY: key },
      stdout: "pipe",
      stderr: "inherit",
    });
    const { value } = await server.stdout.getReader().read();
    const port = Number(new URL(new TextDecoder().decode(value)).port);
    const first = tls.connect({ host: "localhost", port, ca: [shortNotCA, root] });
    const [session] = await once(first, "session");
    first.destroy();
    const secureContext = tls.createSecureContext({ ca: other });
    const socket = tls.connect({ host: "localhost", port, secureContext, session, rejectUnauthorized: false });
    await once(socket, "secureConnect");
    const resumed = socket.isSessionReused();
    secureContext.context.addCACert(root);
    // The response comes after a renegotiation.
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    const [response] = await once(socket, "data");
    socket.destroy();
    expect([resumed, String(response).slice(0, 15), socket.authorized]).toEqual([true, "HTTP/1.1 200 OK", false]);
  });

  it("a session that was replaced before the handshake is not the one that is verified again", async () => {
    const chain = [rogueLeaf, int, rogueInt];
    const [replaced, session] = await Promise.all([sessionOf([leaf, forgedInt, int], both), sessionOf(chain, both)]);
    using socket = await bunConnect(chain, both, socket => {
      socket.setSession(replaced);
      socket.getPeerCertificate(false);
      socket.getAuthorizationError();
      socket.setSession(session);
    });
    const seen = [socket.authorized, socket.isSessionReused(), issuerSeenBy(socket)];
    expect(seen).toEqual([true, true, ...serialsOf([rogueInt])]);
  });
});
