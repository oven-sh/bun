import { afterAll, describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign, X509Certificate, type KeyPairKeyObjectResult as KeyPair } from "crypto";
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

  const [serverAuth, clientAuth] = [oid("2b06010505070301"), oid("2b06010505070302")];
  const keyCertSign = extension("551d0f", hex("03020106")); // and cRLSign
  const isCA = [extension("551d13", seq(hex("0101ff"))), keyCertSign];
  const notCA = extension("551d13", seq());
  const localhost = extension("551d11", seq(tlv(0x82, Buffer.from("localhost")), tlv(0x87, hex("7f000001"))), false);
  const onlyExampleCom = extension("551d1e", seq(tlv(0xa0, seq(tlv(0x82, Buffer.from("example.com"))))));

  const [rootKey, intKey, otherKey, leafKey] = [0, 1, 2, 3].map(() =>
    generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
  );
  const key = leafKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  type Spec = { issuer: string; key: KeyPair; signer: KeyPair; extensions: Buffer[]; padding: number; until: number };
  let serial = 0x100;
  /** Without key identifiers, so that only the name tells who the issuer may be. */
  function mint(subject: string, { issuer, key, signer, extensions, padding, until }: Spec) {
    const tbs = seq(
      hex("a003020102"),
      tlv(0x02, hex((serial++).toString(16).padStart(4, "0"))),
      ecdsa,
      dn(issuer),
      seq(time(2020), time(until)),
      dn(subject),
      key.publicKey.export({ type: "spki", format: "der" }),
      tlv(0xa3, seq(...extensions, extension("2a0305", Buffer.alloc(padding), false))),
    );
    return armor("CERTIFICATE", signed(tbs, signer));
  }
  const usual = { extensions: isCA, padding: 100, until: 2120 };
  const mintRoot = (spec?: Partial<Spec>) =>
    mint("root", { ...usual, issuer: "root", key: rootKey, signer: rootKey, ...spec });
  const mintInt = (spec?: Partial<Spec>) =>
    mint("int", { ...usual, issuer: "root", key: intKey, signer: rootKey, ...spec });
  const mintLeaf = (spec?: Partial<Spec>) =>
    mint("leaf", { ...usual, issuer: "int", key: leafKey, signer: intKey, extensions: [notCA, localhost], ...spec });
  const crlOf = (issuer: string, signer: KeyPair, ...revoked: string[]) => {
    const entries = revoked.map(pem => seq(tlv(0x02, hex(new X509Certificate(pem).serialNumber)), time(2020)));
    const list = entries.length ? seq(...entries) : hex("");
    return armor("X509 CRL", signed(seq(hex("020101"), ecdsa, dn(issuer), time(2020), time(2120), list), signer));
  };
  const distrusted = (pem: string) =>
    armor("TRUSTED CERTIFICATE", Buffer.concat([new X509Certificate(pem).raw, seq(tlv(0xa0, serverAuth))]));

  const [root, int, leaf] = [mintRoot(), mintInt(), mintLeaf()];
  const other = mint("other", { ...usual, issuer: "other", key: otherKey, signer: otherKey });
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
  const constrained = () => mintRoot({ extensions: [...isCA, onlyExampleCom], padding: 1 });
  const anyName = { checkServerIdentity: () => undefined };
  const loop = () => [
    mintInt({ issuer: "loop" }),
    mint("loop", { ...usual, issuer: "int", key: rootKey, signer: otherKey }),
  ];
  const decoys = (count: number) => Array.from({ length: count }, () => mintInt({ key: otherKey, signer: otherKey }));

  const servers = new Map<string, Promise<Server>>();
  afterAll(async () => {
    for (const server of servers.values()) (await server).close();
  });
  async function portOf(chain: string[]) {
    const cert = chain.join("");
    if (!servers.has(cert)) {
      const server = tls.createServer({ key, cert });
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
      { ca: [root, int, mintInt({ padding: 200 })], crl: [crlOf("root", rootKey, int), crlOf("int", intKey)] },
    ],
    ["a partial chain", [leaf], { ca: [mintInt({ key: leafKey, padding: 1 }), int], allowPartialTrustChain: true }],
    [
      "a pinned leaf",
      [leaf],
      { ca: [leaf, mintInt({ extensions: [notCA, keyCertSign] })], allowPartialTrustChain: true },
    ],
    [
      "a self-signed leaf that may not sign certificates",
      [selfSigned],
      { ca: [mintLeaf({ issuer: "leaf" }), selfSigned] },
    ],
    [
      "a pinned leaf that its issuer does not permit",
      [leaf],
      { ca: [leaf, mintInt({ extensions: [...isCA, onlyExampleCom] })], allowPartialTrustChain: true },
    ],
    ["a common name that one copy does not permit", [namedByCN, int], { ca: [constrained(), root], ...anyName }],
    ["a path listed after a loop", [leaf, ...loop(), int], { ca: root }],
    [
      "a path listed after many dead ends",
      [leaf, int, mintInt(byOther)],
      { ca: [other, ...Array.from({ length: 6 }, () => mintRoot({ key: leafKey, signer: leafKey }))] },
    ],
    ["100 issuers to try", [leaf, ...decoys(49), int], { ca: root }],
  ] as [string, string[], tls.ConnectionOptions][])("accepts %s", async (_, chain, options) => {
    expect(await connect(chain, options)).toBe("authorized");
  });

  it.each([
    ["two unusable copies", [leaf, int], { ca: [shortNotCA, rootByOther] }, "INVALID_PURPOSE"],
    ["...in the other order", [leaf, int], { ca: [rootByOther, shortNotCA] }, "INVALID_PURPOSE"],
    ["an expired leaf", [mintLeaf({ until: 2021 }), int], { ca: [root, mintRoot()] }, "CERT_HAS_EXPIRED"],
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
      { ca: [root, mintRoot()], crl: [crlOf("root", rootKey), crlOf("int", intKey, leaf)] },
      "CERT_REVOKED",
    ],
    ["a root that only the server sent", [leaf, int, root], { ca: shortNotCA }, "INVALID_PURPOSE"],
    ["intermediates without their root", [leaf], { ca: [int, mintInt()] }, "UNABLE_TO_GET_ISSUER_CERT"],
    [
      "the wrong host",
      [leaf, int],
      { ca: [shortNotCA, root], servername: "example.com" },
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ],
    ["more than 100 issuers to try", [leaf, ...decoys(50), int], { ca: root }, "CERT_SIGNATURE_FAILURE"],
    [
      "a common name that no copy permits",
      [namedByCN, int],
      { ca: [constrained(), constrained()], ...anyName },
      "UNSPECIFIED",
    ],
    ["nothing but loops", [leaf, ...Array.from({ length: 20 }, loop).flat()], { ca: root }, "CERT_SIGNATURE_FAILURE"],
  ] as [string, string[], tls.ConnectionOptions, string][])("refuses %s", async (_, chain, options, code) => {
    expect(await connect(chain, options)).toBe(code);
  });

  it.each([
    ["nothing", [leaf, int], [root], "authorized"],
    ["the leaf", [leaf, int], [distrusted(leaf), root], "CERT_REJECTED"],
    ["the intermediate", [leaf, int], [distrusted(int), root], "CERT_REJECTED"],
    ["the intermediate, and the server has another copy", [leaf, mintInt()], [distrusted(int), root], "CERT_REJECTED"],
    [
      "the root, and the server has a cross-signed copy",
      [leaf, int, rootByOther],
      [distrusted(root), other],
      "UNABLE_TO_GET_ISSUER_CERT",
    ],
    ["the root, and another path avoids it", [leaf, int, mintInt(byOther)], [distrusted(root), other], "authorized"],
  ])("caFile distrusts %s", async (_, chain, file, expected) => {
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

  const rogueInt = mintInt({ ...byOther, key: leafKey });
  const rogueLeaf = mintLeaf({ signer: leafKey });
  const otherAsIfByRoot = mint("other", { ...usual, issuer: "root", key: otherKey, signer: otherKey });
  it.each([
    ["an ordinary chain", [leaf, int], [root], [leaf, int, root]],
    ["a cross-signed root", [leaf, int, rootByOther], [root, other], [leaf, int, rootByOther, other]],
    ["two intermediates from the server", [rogueLeaf, int, rogueInt], [root, other], [rogueLeaf, rogueInt, other]],
    ["one from the server and one in `ca`", [rogueLeaf, int], [root, other, rogueInt], [rogueLeaf, rogueInt, other]],
    ["two roots in `ca`", [leaf, int], [shortOtherKey, root], [leaf, int, root]],
    [
      "a copy of the root that names another issuer",
      [rogueLeaf, rogueInt, otherAsIfByRoot],
      [root, other],
      [rogueLeaf, rogueInt, otherAsIfByRoot],
    ],
    ["100 signatures to check", [leaf, ...decoys(99), int], [other], [leaf, int]],
    ["more than 100 signatures to check", [leaf, ...decoys(100), int], [other], [leaf]],
  ])("getPeerCertificate(true) links to whoever signed: %s", async (_, chain, ca, expected) => {
    const socket = tls.connect({ host: "127.0.0.1", port: await portOf(chain), ca, rejectUnauthorized: false });
    try {
      await once(socket, "secureConnect");
      const serials = new Set<string>();
      for (let cert = socket.getPeerCertificate(true); cert && !serials.has(cert.serialNumber);) {
        serials.add(cert.serialNumber);
        cert = cert.issuerCertificate;
      }
      expect([...serials]).toEqual(expected.map(pem => new X509Certificate(pem).serialNumber));
    } finally {
      socket.destroy();
    }
  });
});
