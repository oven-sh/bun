import { describe, expect, it } from "bun:test";
import { once } from "events";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tls as harnessCert, invalidTls, isLinux, tempDir, tmpdirSync } from "harness";
import { generateKeyPairSync, sign, X509Certificate, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";
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
    // Name constraints are enforced on the chain actually built: a valid constrained copy in the trust set still wins
    // (trusted first) and rejects; an expired constrained copy is absent, and trusting `root` means trusting what it
    // issued. (was UNSPECIFIED, i.e. rejected via the expired constrained copy)
    [
      "valid constrained trusted intermediate still applies its constraints",
      ["leaf", "int-valid"],
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

// Bun sorts `ca` by length, hence the "shorter" and "longer" sizes.
describe("several trusted certificates match one issuer", () => {
  const tlv = (tag: number, ...body: Buffer[]) => {
    const { length } = Buffer.concat(body);
    const header = length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : [0x82, length >> 8, length & 0xff];
    return Buffer.concat([Buffer.from([tag, ...header]), ...body]);
  };
  const hex = (text: string) => Buffer.from(text, "hex");
  const seq = (...body: Buffer[]) => tlv(0x30, ...body);
  const oid = (text: string) => tlv(0x06, hex(text));
  const time = (text: string) => tlv(0x18, Buffer.from(text));
  const dn = (cn: string) => seq(tlv(0x31, seq(oid("550403"), tlv(0x0c, Buffer.from(cn)))));
  const extension = (id: string, value: Buffer, critical = false) =>
    seq(oid(id), hex(critical ? "0101ff" : ""), tlv(0x04, value));
  const armor = (label: string, der: Buffer) =>
    `-----BEGIN ${label}-----\n${der.toString("base64").replace(/.{64}(?!$)/g, "$&\n")}\n-----END ${label}-----\n`;
  const ecdsaWithSha256 = seq(oid("2a8648ce3d040302"));
  type KeyPair = { publicKey: KeyObject; privateKey: KeyObject };
  const signed = (tbs: Buffer, { privateKey }: KeyPair) =>
    seq(tbs, ecdsaWithSha256, tlv(0x03, hex("00"), sign("sha256", tbs, privateKey)));

  const [serverAuth, clientAuth, emailProtection] = ["01", "02", "04"].map(n => oid(`2b060105050703${n}`));
  const isCA = extension("551d13", seq(hex("0101ff")), true);
  const notCA = extension("551d13", seq(), true);
  const pathLen0 = extension("551d13", seq(hex("0101ff020100")), true);
  const keyCertSign = extension("551d0f", hex("03020106"), true); // and cRLSign
  const digitalSignature = extension("551d0f", hex("03020780"), true);
  const eku = (purpose: Buffer) => extension("551d25", seq(purpose));
  const unknownCritical = extension("2a0304", hex("0500"), true);
  const requireExplicitPolicy = extension("551d24", seq(hex("800100")));
  const permitOnlyExampleCom = extension("551d1e", seq(tlv(0xa0, seq(tlv(0x82, Buffer.from("example.com"))))), true);
  const subjectKeyId = (id: string) => extension("551d0e", tlv(0x04, hex(id)));
  const authorityKeyId = (id: string) => extension("551d23", seq(tlv(0x80, hex(id))));
  const localhost = extension("551d11", seq(tlv(0x82, Buffer.from("localhost"))));
  const ca = [isCA, keyCertSign];

  const [caKey, otherKey, leafKey] = [0, 1, 2].map(() => generateKeyPairSync("ec", { namedCurve: "prime256v1" }));
  const key = leafKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const padding = { shorter: 1, usual: 100, longer: 200 };
  type Size = keyof typeof padding;
  type Options = { size?: Size; subjectKey?: KeyPair; signer?: KeyPair; issuer?: string; notAfter?: string };

  let serial = 0x100;
  function mint(subject: string, issuedBy: string, extensions: Buffer[], options: Options = {}) {
    const { size = "usual", subjectKey = caKey, signer = caKey, issuer = issuedBy } = options;
    const tbs = seq(
      hex("a003020102"),
      tlv(0x02, hex((serial++).toString(16).padStart(4, "0"))),
      ecdsaWithSha256,
      dn(issuer),
      seq(time("20200101000000Z"), time(options.notAfter ?? "21200101000000Z")),
      dn(subject),
      subjectKey.publicKey.export({ type: "spki", format: "der" }),
      tlv(0xa3, seq(...extensions, extension("2a0305", tlv(0x04, Buffer.alloc(padding[size]))))),
    );
    return armor("CERTIFICATE", signed(tbs, signer));
  }
  const leafOf = (issuer: string, purpose = serverAuth) =>
    mint("leaf", issuer, [notCA, eku(purpose), localhost], { subjectKey: leafKey });
  function crlOf(issuer: string, ...revoked: string[]) {
    const entries = revoked.map(pem =>
      seq(tlv(0x02, hex(new X509Certificate(pem).serialNumber)), time("20200101000000Z")),
    );
    const tbs = seq(
      hex("020101"),
      ecdsaWithSha256,
      dn(issuer),
      time("20200101000000Z"),
      time("21200101000000Z"),
      entries.length ? seq(...entries) : hex(""),
    );
    return armor("X509 CRL", signed(tbs, caKey));
  }

  const root = mint("root", "root", ca);
  const intermediate = mint("intermediate", "root", ca);
  const leaf = leafOf("intermediate");
  const chain = leaf + intermediate;
  const clientChain = leafOf("intermediate", clientAuth) + intermediate;

  // [what is wrong with it, extensions, options, the error when nothing better is trusted]
  const unusable: [string, Buffer[], Options, string][] = [
    ["CA:FALSE", [notCA, keyCertSign], {}, "INVALID_PURPOSE"],
    ["no basicConstraints and no keyUsage", [], {}, "INVALID_PURPOSE"],
    ["extendedKeyUsage=clientAuth", [...ca, eku(clientAuth)], {}, "INVALID_PURPOSE"],
    ["an unknown critical extension", [...ca, unknownCritical], {}, "UNSPECIFIED"],
    ["pathlen:0", [pathLen0, keyCertSign], {}, "PATH_LENGTH_EXCEEDED"],
    ["requireExplicitPolicy:0", [...ca, requireExplicitPolicy], {}, "UNSPECIFIED"],
    ["another key", ca, { subjectKey: otherKey, signer: otherKey }, "CERT_SIGNATURE_FAILURE"],
    ["an unknown issuer", ca, { issuer: "unknown" }, "UNABLE_TO_GET_ISSUER_CERT"],
    ["an expired validity", ca, { notAfter: "20210101000000Z" }, "CERT_HAS_EXPIRED"],
  ];
  const twin = (defect: string, size: Size, subject = "root", issuer = "root") => {
    const [, extensions, options] = unusable.find(([name]) => name === defect)!;
    return mint(subject, issuer, extensions, { ...options, size });
  };

  const serve = (cert: string) => Bun.serve({ port: 0, tls: { key, cert }, fetch: () => new Response("authorized") });
  async function connect(port: number | undefined, options: tls.ConnectionOptions) {
    const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", ...options });
    try {
      await once(socket, "secureConnect");
      return "authorized";
    } catch (error: any) {
      return error.code;
    } finally {
      socket.destroy();
    }
  }
  async function verify(cert: string, ca: string[], options?: tls.ConnectionOptions) {
    await using server = serve(cert);
    return await connect(server.port, { ca, ...options });
  }
  /** What the server makes of the client's certificate, and the last certificate each side reports for the other. */
  async function mutual(serverOptions: tls.TlsOptions, clientOptions: tls.ConnectionOptions) {
    const rootOf = (socket: TLSSocket) => {
      let cert = socket.getPeerCertificate(true);
      while (cert.issuerCertificate && cert.issuerCertificate !== cert) cert = cert.issuerCertificate;
      return armor("CERTIFICATE", cert.raw);
    };
    await using server = tls.createServer({ key, requestCert: true, rejectUnauthorized: false, ...serverOptions });
    const accepted = Promise.withResolvers<TLSSocket>();
    server.on("secureConnection", accepted.resolve).on("tlsClientError", accepted.reject);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const client = tls.connect({
      host: "127.0.0.1",
      port,
      servername: "localhost",
      key,
      cert: clientChain,
      ...clientOptions,
    });
    try {
      const [peer] = await Promise.all([accepted.promise, once(client, "secureConnect")]);
      return {
        client: peer.authorized ? "authorized" : peer.authorizationError,
        rootOfClient: rootOf(peer),
        rootOfServer: rootOf(client),
      };
    } finally {
      client.destroy();
    }
  }

  it("the sizes order the certificates", () => {
    const lengths = (size: Size) => unusable.map(([defect]) => new X509Certificate(twin(defect, size)).raw.length);
    const { length } = new X509Certificate(root).raw;
    expect(Math.max(...lengths("shorter"))).toBeLessThan(length);
    expect(Math.min(...lengths("longer"))).toBeGreaterThan(length);
  });

  describe.each(["shorter", "longer"] as const)("a %s copy", size => {
    it.each(unusable)("of the root with %s", async (defect, _extensions, _options, code) => {
      const bad = twin(defect, size);
      const keyUsageOnly = mint("root", "root", [keyCertSign]);
      await using server = serve(chain);
      const get = (ca: string[]) =>
        fetch(`https://localhost:${server.port}`, { tls: { ca }, keepalive: false }).then(
          response => response.text(),
          error => error.code,
        );
      expect({
        alone: await connect(server.port, { ca: [bad] }),
        after: await connect(server.port, { ca: [root, bad] }),
        before: await connect(server.port, { ca: [bad, root] }),
        beforeKeyUsageOnly: await connect(server.port, { ca: [bad, keyUsageOnly] }),
        fetchAfter: await get([root, bad]),
        fetchBefore: await get([bad, root]),
      }).toEqual({
        alone: code,
        after: "authorized",
        before: "authorized",
        beforeKeyUsageOnly: "authorized",
        fetchAfter: "authorized",
        fetchBefore: "authorized",
      });
    });

    it.each([
      ["CA:FALSE", "INVALID_PURPOSE"],
      ["extendedKeyUsage=clientAuth", "INVALID_PURPOSE"],
      ["an unknown issuer", "UNABLE_TO_GET_ISSUER_CERT"],
    ])("of an intermediate with %s", async (defect, code) => {
      const bad = twin(defect, size, "intermediate");
      await using server = serve(leaf);
      expect({
        alone: await connect(server.port, { ca: [root, bad] }),
        after: await connect(server.port, { ca: [root, intermediate, bad] }),
        before: await connect(server.port, { ca: [root, bad, intermediate] }),
        withBadRoot: await connect(server.port, { ca: [twin("CA:FALSE", size), bad, intermediate, root] }),
        asAnchor: await connect(server.port, { ca: [bad, intermediate], allowPartialTrustChain: true }),
      }).toEqual({
        alone: code,
        after: "authorized",
        before: "authorized",
        withBadRoot: "authorized",
        asAnchor: "authorized",
      });
    });

    it("among the bundled roots, for every connection of a context", async () => {
      const bad = twin("CA:FALSE", size);
      await using server = serve(chain);
      const outcomes: string[] = [];
      for (const ends of [
        [root, bad],
        [bad, root],
      ]) {
        const secureContext = tls.createSecureContext({ ca: [ends[0], ...tls.rootCertificates.slice(0, 40), ends[1]] });
        for (let i = 0; i < 3; i++) outcomes.push(await connect(server.port, { secureContext }));
      }
      expect(outcomes).toEqual(Array(6).fill("authorized"));
    });
  });

  it.each(unusable.slice(0, -1))(
    "with nothing usable, %s is reported when it is the shorter",
    async (defect, _, __, code) => {
      const first = twin(defect, "shorter");
      await using server = serve(chain);
      const outcomes = new Set<string>();
      for (const [other] of unusable) {
        outcomes.add(await connect(server.port, { ca: [first, twin(other, "longer")] }));
      }
      outcomes.add(await connect(server.port, { ca: [twin("CA:FALSE", "longer"), first] }));
      expect([...outcomes]).toEqual([code]);
    },
  );

  it("all of them do not hide the root", async () => {
    expect(await verify(chain, [...unusable.map(([defect]) => twin(defect, "shorter")), root])).toBe("authorized");
  });

  it("the copy a server sends makes no difference", async () => {
    const bad = twin("CA:FALSE", "shorter");
    expect({
      sendsBad: await verify(chain + bad, [bad, root]),
      sendsRoot: await verify(chain + root, [bad, root]),
      onlyBadTrusted: await verify(chain + root, [bad]),
      onlyBadIntermediateTrusted: await verify(chain, [root, twin("CA:FALSE", "usual", "intermediate")]),
    }).toEqual({
      sendsBad: "authorized",
      sendsRoot: "authorized",
      onlyBadTrusted: "INVALID_PURPOSE",
      onlyBadIntermediateTrusted: "INVALID_PURPOSE",
    });
  });

  it("an intermediate is passed over for the roots above it", async () => {
    const underBadRoot = mint("intermediate", "bad root", ca, { size: "shorter" });
    const badRoot = twin("CA:FALSE", "usual", "bad root", "bad root");
    expect(await verify(leaf, [underBadRoot, badRoot, intermediate, root])).toBe("authorized");
  });

  it("two CAs that certified each other", async () => {
    const loop = [mint("root", "partner", ca, { size: "shorter" }), mint("partner", "root", ca)];
    expect({ alone: await verify(chain, loop), withRoot: await verify(chain, [...loop, root]) }).toEqual({
      alone: "CERT_CHAIN_TOO_LONG",
      withRoot: "authorized",
    });
  });

  it("a path that is too long is passed over", async () => {
    // With the leaf and one more certificate, this many reach the limit of 102.
    const sent = Array.from({ length: 100 }, (_, i) => mint(`ca ${i}`, i === 99 ? "root" : `ca ${i + 1}`, ca));
    const crossed = [mint("root", "older root", ca, { size: "shorter" }), mint("older root", "older root", ca)];
    await using server = serve(leafOf("ca 0") + sent.join(""));
    expect({
      alone: await connect(server.port, { ca: crossed }),
      withRoot: await connect(server.port, { ca: [...crossed, root] }),
    }).toEqual({ alone: "CERT_CHAIN_TOO_LONG", withRoot: "authorized" });
  });

  it("the error is the certificate's own when there is a usable root", async () => {
    expect(await verify(clientChain, [twin("pathlen:0", "shorter"), root])).toBe("INVALID_PURPOSE");
    expect(await verify(chain, [twin("CA:FALSE", "shorter"), root], { servername: "example.com" })).toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
  });

  it("key identifiers have to match", async () => {
    const issued = leaf + mint("intermediate", "root", [...ca, authorityKeyId("01")]);
    const current = mint("root", "root", [...ca, subjectKeyId("01")]);
    const options = { subjectKey: otherKey, signer: otherKey, size: "shorter" } as const;
    const other = mint("root", "root", [...ca, subjectKeyId("02")], options);
    const mislabelled = mint("root", "root", [...ca, subjectKeyId("02")]);
    expect([
      await verify(issued, [other]),
      await verify(issued, [other, current]),
      await verify(issued, [twin("CA:FALSE", "shorter"), twin("CA:FALSE", "longer"), mislabelled]),
    ]).toEqual(["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "authorized", "INVALID_PURPOSE"]);
  });

  it("name constraints and revocation are not lifted by another copy", async () => {
    const constrained = mint("root", "root", [...ca, permitOnlyExampleCom], { size: "shorter" });
    const revoked = mint("root", "root", ca, { size: "shorter" });
    const crl = [crlOf("root", revoked), crlOf("intermediate")];
    const bad = twin("no basicConstraints and no keyUsage", "shorter");
    expect({
      constrained: await verify(chain, [constrained, root]),
      constrainedAfterBad: await verify(chain, [bad, constrained, root]),
      revoked: await verify(chain, [revoked, root], { crl }),
      notRevoked: await verify(chain, [bad, root], { crl }),
      leafRevoked: await verify(chain, [bad, root], { crl: [crlOf("root"), crlOf("intermediate", leaf)] }),
    }).toEqual({
      constrained: "UNSPECIFIED",
      constrainedAfterBad: "UNSPECIFIED",
      revoked: "CERT_REVOKED",
      notRevoked: "authorized",
      leafRevoked: "CERT_REVOKED",
    });
  });

  describe.each(["shorter", "longer"] as const)("a %s root for clients and one for servers", size => {
    const forClients = mint("root", "root", [...ca, eku(clientAuth)], { size });
    const forServers = mint("root", "root", [...ca, eku(serverAuth)]);

    it.each([
      ["first", [forClients, forServers]],
      ["last", [forServers, forClients]],
    ])("each side takes its own, the one for clients listed %s", async (_, ca) => {
      expect(await mutual({ cert: chain, ca }, { ca })).toEqual({
        client: "authorized",
        rootOfClient: forClients,
        rootOfServer: forServers,
      });
    });

    it("the one for servers does not vouch for a client", async () => {
      const ca = [forServers, twin("CA:FALSE", size)];
      expect((await mutual({ cert: chain, ca }, { ca })).client).toBe<string>("INVALID_PURPOSE");
    });
  });

  it.each(["CA:FALSE", "an unknown critical extension", "another key", "an unknown issuer", "an expired validity"])(
    "getPeerCertificate(true) passes over a root with %s",
    async defect => {
      const ca = [twin(defect, "shorter"), root];
      expect(await mutual({ cert: chain, ca }, { ca })).toEqual({
        client: "authorized",
        rootOfClient: root,
        rootOfServer: root,
      });
    },
  );

  it("two valid roots", async () => {
    const shorter = mint("root", "root", ca, { size: "shorter" });
    expect((await mutual({ cert: chain }, { ca: [shorter, root] })).rootOfServer).toBe(shorter);
    expect(await verify(chain, [root, shorter])).toBe("authorized");
  });

  it.each(["CA:FALSE", "another key", "an expired validity"])(
    "a server completes its chain past an intermediate with %s",
    async defect => {
      const bad = twin(defect, "shorter", "intermediate");
      expect((await mutual({ cert: leaf, ca: [bad, intermediate, root] }, { ca: [root] })).rootOfServer).toBe(root);
    },
  );

  describe("a certificate that is trusted itself", () => {
    const selfSigned = (extensions: Buffer[], options?: Options) =>
      mint("self", "self", [...extensions, localhost], { subjectKey: leafKey, signer: leafKey, ...options });

    it.each([
      ["CA:FALSE", [notCA]],
      ["keyUsage=digitalSignature", [notCA, digitalSignature]],
      ["CA:TRUE", [isCA]],
    ])("self-signed with %s", async (_, extensions) => {
      const pinned = selfSigned(extensions);
      await using server = serve(pinned);
      const outcomes = new Set<string>();
      for (const size of ["shorter", "longer"] as const) {
        for (const other of [
          selfSigned([isCA], { size }),
          selfSigned([notCA], { size }),
          selfSigned([notCA, digitalSignature], { size }),
          selfSigned([isCA], { size, subjectKey: otherKey, signer: otherKey }),
        ]) {
          outcomes.add(await connect(server.port, { ca: [other, pinned] }));
        }
      }
      expect([...outcomes]).toEqual(["authorized"]);
    });

    it("is not replaced by a copy that is not a CA", async () => {
      expect(await verify(selfSigned([notCA, digitalSignature]), [selfSigned([notCA])])).toBe("INVALID_PURPOSE");
    });

    it("with allowPartialTrustChain", async () => {
      const bad = twin("CA:FALSE", "usual", "intermediate");
      const constrained = mint("intermediate", "root", [...ca, permitOnlyExampleCom], { size: "longer" });
      const manyBad = Array.from({ length: 100 }, () => twin("CA:FALSE", "usual", "intermediate"));
      await using server = serve(leaf);
      expect({
        badIssuer: await connect(server.port, { ca: [leaf, bad], allowPartialTrustChain: true }),
        notAllowed: await connect(server.port, { ca: [leaf, bad, root] }),
        notTrusted: await connect(server.port, { ca: [bad], allowPartialTrustChain: true }),
        constrained: await connect(server.port, { ca: [leaf, constrained], allowPartialTrustChain: true }),
        manyToTry: await connect(server.port, { ca: [leaf, ...manyBad.slice(1)], allowPartialTrustChain: true }),
        tooManyToTry: await connect(server.port, { ca: [leaf, ...manyBad], allowPartialTrustChain: true }),
      }).toEqual({
        badIssuer: "authorized",
        notAllowed: "INVALID_PURPOSE",
        notTrusted: "INVALID_PURPOSE",
        constrained: "UNSPECIFIED",
        manyToTry: "authorized",
        tooManyToTry: "INVALID_PURPOSE",
      });
    });
  });

  describe.concurrent("in the default store", () => {
    type Plan = { trusted: string[]; chains: Record<string, string>; clients: string[] };
    /** Each case has a root name of its own, so that one file, and one process, holds them all. */
    const plan = (cases: Record<string, (name: string) => string[]>): Plan => ({
      trusted: Object.keys(cases).flatMap(name => cases[name](name)),
      chains: Object.fromEntries(Object.keys(cases).map(name => [name, leaf + mint("intermediate", name, ca)])),
      clients: ["tls", "fetch", "http3"],
    });

    async function run(variable: string, args: string[], { trusted, chains, clients }: Plan) {
      using dir = tempDir("trusted-twins", {
        "certs/bundle.pem": trusted.join(""),
        "plan.json": JSON.stringify({ key, chains, clients }),
        "main.mjs": `
          import { once } from "node:events";
          import tls from "node:tls";
          import { key, chains, clients } from "./plan.json";
          const get = (port, init) => fetch("https://localhost:" + port, init).then(res => res.text(), err => err.code);
          const connect = {
            tls(port) {
              const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost" });
              return once(socket, "secureConnect").then(() => "authorized", err => err.code).finally(() => socket.destroy());
            },
            fetch: get,
            http3: port => get(port, { protocol: "http3" }),
          };
          const outcomes = {};
          for (const [name, cert] of Object.entries(chains)) {
            const server = Bun.serve({ port: 0, tls: { key, cert }, http3: true, fetch: () => new Response("authorized") });
            outcomes[name] = {};
            for (const client of clients) outcomes[name][client] = await connect[client](server.port);
            server.stop(true);
          }
          console.log(JSON.stringify(outcomes));
          process.exit(0);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args, "main.mjs"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          NODE_EXTRA_CA_CERTS: undefined,
          NODE_USE_SYSTEM_CA: undefined,
          SSL_CERT_FILE: "",
          SSL_CERT_DIR: "",
          [variable]: join(String(dir), "certs", variable === "SSL_CERT_DIR" ? "" : "bundle.pem"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      return { outcomes: JSON.parse(stdout), exitCode };
    }
    const authorized = { tls: "authorized", fetch: "authorized", http3: "authorized" };
    const refused = (code: string) => ({ tls: code, fetch: code, http3: "HTTP3HandshakeFailed" });
    const good = (name: string) => mint(name, name, ca);

    const bothOrders = Object.fromEntries(
      unusable.flatMap(([defect]) => [
        [`${defect}, before`, (name: string) => [twin(defect, "usual", name, name), good(name)]],
        [`${defect}, after`, (name: string) => [good(name), twin(defect, "usual", name, name)]],
      ]),
    );
    const everyOneAuthorized = {
      outcomes: Object.fromEntries(Object.keys(bothOrders).map(name => [name, authorized])),
      exitCode: 0,
    };

    it("NODE_EXTRA_CA_CERTS", async () => {
      expect(await run("NODE_EXTRA_CA_CERTS", [], plan(bothOrders))).toEqual(everyOneAuthorized);
    });

    // On Linux the system store has every file of $SSL_CERT_DIR.
    it.skipIf(!isLinux)("--use-system-ca", async () => {
      expect(await run("SSL_CERT_DIR", ["--use-system-ca"], plan(bothOrders))).toEqual(everyOneAuthorized);
    });

    it("the search for a path is bounded", async () => {
      // 2^40 paths, none of which ends in a root.
      const maze = (name: string) =>
        Array.from({ length: 80 }, (_, i) => mint(i < 2 ? name : `level ${i >> 1}`, `level ${(i >> 1) + 1}`, ca));
      expect(await run("NODE_EXTRA_CA_CERTS", [], plan({ maze }))).toEqual({
        outcomes: { maze: refused("UNABLE_TO_GET_ISSUER_CERT") },
        exitCode: 0,
      });
    });

    // At one of these sizes a packet ends before the server's Finished, and the client asks BoringSSL why it has to wait.
    it("passing over a certificate leaves no error behind", async () => {
      const sizes = Array.from({ length: 56 }, (_, i) => i * 24);
      const leafWith = (size: number) =>
        mint("leaf", "root", [localhost, extension("2a0306", Buffer.alloc(size))], { subjectKey: leafKey });
      expect(
        await run("NODE_EXTRA_CA_CERTS", [], {
          trusted: [twin("another key", "usual"), root],
          chains: Object.fromEntries(sizes.map(size => [size, leafWith(size)])),
          clients: ["http3"],
        }),
      ).toEqual({ outcomes: Object.fromEntries(sizes.map(size => [size, { http3: "authorized" }])), exitCode: 0 });
    });

    // The store keeps up to 16 certificates in order, those with trust settings first.
    it("SSL_CERT_FILE", async () => {
      const der = (pem: string) => new X509Certificate(pem).raw;
      const withSettings = (pem: string, settings: Buffer) =>
        armor("TRUSTED CERTIFICATE", Buffer.concat([der(pem), seq(settings)]));
      const trust = (purpose: Buffer) => seq(purpose);
      const reject = (purpose: Buffer) => tlv(0xa0, purpose);
      const cases = plan({
        "CA:FALSE": name => [twin("CA:FALSE", "usual", name, name), good(name)],
        "does not parse": name => [mint(name, name, ca, { notAfter: "2120XXXX000000Z" }), good(name)],
        "rejected": name => [withSettings(good(name), reject(serverAuth)), good(name)],
        "rejected, unknown issuer": name => [
          withSettings(twin("an unknown issuer", "usual", name), reject(serverAuth)),
          good(name),
        ],
        "for email": name => [
          withSettings(twin("CA:FALSE", "usual", name, name), trust(serverAuth)),
          withSettings(good(name), trust(emailProtection)),
          good(name),
        ],
        "for email, CA:FALSE": name => [
          withSettings(twin("CA:FALSE", "usual", name, name), trust(emailProtection)),
          good(name),
        ],
        "another key rejected": name => [
          withSettings(twin("another key", "usual", name, name), reject(serverAuth)),
          good(name),
        ],
      });
      expect(await run("SSL_CERT_FILE", [], cases)).toEqual({
        outcomes: {
          "CA:FALSE": authorized,
          "does not parse": authorized,
          "rejected": refused("UNABLE_TO_GET_ISSUER_CERT"),
          "rejected, unknown issuer": refused("UNABLE_TO_GET_ISSUER_CERT"),
          "for email": refused("UNABLE_TO_GET_ISSUER_CERT"),
          "for email, CA:FALSE": refused("INVALID_PURPOSE"),
          "another key rejected": authorized,
        },
        exitCode: 0,
      });
    });
  });
});
