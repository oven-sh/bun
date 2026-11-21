import { describe, expect, it } from "bun:test";
import { once } from "events";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tls as harnessCert, invalidTls, isLinux, tempDir, tmpdirSync } from "harness";
import { generateKeyPairSync, sign, X509Certificate, type KeyObject } from "node:crypto";
import https from "node:https";
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
    // pinning only an expired intermediate fails closed, as in Node.js: through it, then no root
    ["ca = only the expired intermediate", ["leaf", "int-valid"], ["int-expired"], "UNABLE_TO_GET_ISSUER_CERT"],
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

// The outcomes are those of Node.js v26.12.1 on glibc, whose qsort keeps the order of a list, unless a test says otherwise.
describe("several certificates match one issuer", () => {
  const tlv = (tag: number, ...body: Buffer[]) => {
    const { length } = Buffer.concat(body);
    const header = length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : [0x82, length >> 8, length & 0xff];
    return Buffer.concat([Buffer.from([tag, ...header]), ...body]);
  };
  const hex = (text: string) => Buffer.from(text, "hex");
  const seq = (...body: Buffer[]) => tlv(0x30, ...body);
  const oid = (text: string) => tlv(0x06, hex(text));
  const time = (text: string) => tlv(0x18, Buffer.from(text));
  const rdn = (type: string, value: string) => tlv(0x31, seq(oid(type), tlv(0x0c, Buffer.from(value))));
  type Name = string | Buffer;
  const dn = (name: Name) => (typeof name === "string" ? seq(rdn("550403", name)) : name);
  const extension = (id: string, value: Buffer, critical = false) =>
    seq(oid(id), hex(critical ? "0101ff" : ""), tlv(0x04, value));
  const armor = (label: string, der: Buffer) =>
    `-----BEGIN ${label}-----\n${der.toString("base64").replace(/.{64}(?!$)/g, "$&\n")}\n-----END ${label}-----\n`;
  type KeyPair = { publicKey: KeyObject; privateKey: KeyObject };
  const isEC = ({ privateKey }: KeyPair) => privateKey.asymmetricKeyType === "ec";
  const algorithm = (signer: KeyPair) => seq(oid(isEC(signer) ? "2a8648ce3d040302" : "2b6570"));
  const signed = (tbs: Buffer, signer: KeyPair) =>
    seq(tbs, algorithm(signer), tlv(0x03, hex("00"), sign(isEC(signer) ? "sha256" : null, tbs, signer.privateKey)));

  const [serverAuth, clientAuth] = ["01", "02"].map(n => oid(`2b060105050703${n}`));
  const isCA = extension("551d13", seq(hex("0101ff")), true);
  const notCA = extension("551d13", seq(), true);
  const pathLen0 = extension("551d13", seq(hex("0101ff020100")), true);
  const keyCertSign = extension("551d0f", hex("03020106"), true); // and cRLSign
  const digitalSignature = extension("551d0f", hex("03020780"), true);
  const eku = (purpose: Buffer) => extension("551d25", seq(purpose));
  const unknownCritical = extension("2a0304", hex("0500"), true);
  const permitOnlyExampleCom = extension("551d1e", seq(tlv(0xa0, seq(tlv(0x82, Buffer.from("example.com"))))), true);
  const subjectKeyId = (id: string) => extension("551d0e", tlv(0x04, hex(id)));
  const authorityKeyId = (id: string) => extension("551d23", seq(tlv(0x80, hex(id))));
  const localhost = extension("551d11", seq(tlv(0x82, Buffer.from("localhost")), tlv(0x87, hex("7f000001"))));
  const ca = [isCA, keyCertSign];

  const [caKey, otherKey, leafKey] = [0, 1, 2].map(() => generateKeyPairSync("ec", { namedCurve: "prime256v1" }));
  const ed25519Key = generateKeyPairSync("ed25519");
  const key = leafKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const padding = { shorter: 1, usual: 100, longer: 200 };
  type Size = keyof typeof padding;
  type Options = { size?: Size; subjectKey?: KeyPair; signer?: KeyPair; issuer?: string; from?: string; to?: string };

  let serial = 0x100;
  function mint(subject: Name, issuedBy: Name, extensions: Buffer[], options: Options = {}) {
    const { size = "usual", subjectKey = caKey, signer = caKey, issuer = issuedBy } = options;
    const tbs = seq(
      hex("a003020102"),
      tlv(0x02, hex((serial++).toString(16).padStart(4, "0"))),
      algorithm(signer),
      dn(issuer),
      seq(time(`${options.from ?? "2020"}0101000000Z`), time(`${options.to ?? "2120"}0101000000Z`)),
      dn(subject),
      subjectKey.publicKey.export({ type: "spki", format: "der" }),
      tlv(0xa3, seq(...extensions, extension("2a0305", tlv(0x04, Buffer.alloc(padding[size]))))),
    );
    return armor("CERTIFICATE", signed(tbs, signer));
  }
  const leafOf = (issuer: Name, purpose = serverAuth) =>
    mint("leaf", issuer, [notCA, eku(purpose), localhost], { subjectKey: leafKey });
  function crlOf(issuer: string, ...revoked: string[]) {
    const entries = revoked.map(pem =>
      seq(tlv(0x02, hex(new X509Certificate(pem).serialNumber)), time("20200101000000Z")),
    );
    const tbs = seq(
      hex("020101"),
      algorithm(caKey),
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
  const unrelated = Array.from({ length: 40 }, (_, i) => mint(`unrelated ${i}`, `unrelated ${i}`, ca));

  // [what is wrong with it, extensions, options, the error it gives]
  type Defect = [string, Buffer[], Options, string];
  const taken: Defect[] = [
    ["CA:FALSE", [notCA, keyCertSign], {}, "INVALID_PURPOSE"],
    ["no basicConstraints and no keyUsage", [], {}, "INVALID_PURPOSE"],
    ["extendedKeyUsage=clientAuth", [...ca, eku(clientAuth)], {}, "INVALID_PURPOSE"],
    ["an unknown critical extension", [...ca, unknownCritical], {}, "UNSPECIFIED"],
    ["pathlen:0", [pathLen0, keyCertSign], {}, "PATH_LENGTH_EXCEEDED"],
    ["name constraints", [...ca, permitOnlyExampleCom], {}, "UNSPECIFIED"],
    ["another key", ca, { subjectKey: otherKey, signer: otherKey }, "CERT_SIGNATURE_FAILURE"],
    ["an unknown issuer", ca, { issuer: "unknown" }, "UNABLE_TO_GET_ISSUER_CERT"],
  ];
  const passedOver: Defect[] = [
    ["a validity that ended", ca, { to: "2021" }, "CERT_HAS_EXPIRED"],
    ["a validity that has not begun", ca, { from: "2100" }, "CERT_NOT_YET_VALID"],
    ["another type of key", ca, { subjectKey: ed25519Key, signer: ed25519Key }, "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"],
  ];
  const copy = (defect: string, size: Size = "usual", subject = "root", issuer = "root") => {
    const [, extensions, options] = [...taken, ...passedOver].find(([name]) => name === defect)!;
    return mint(subject, issuer, extensions, { ...options, size });
  };

  async function serve(cert: string, options?: tls.TlsOptions) {
    const server = https.createServer({ key, cert, ...options }, (_, response) => response.end("authorized"));
    await once(server.listen(0, "127.0.0.1"), "listening");
    return Object.assign(server, { port: (server.address() as AddressInfo).port });
  }
  async function connect(port: number, options: tls.ConnectionOptions) {
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
    await using server = await serve(cert);
    return await connect(server.port, { ca, ...options });
  }
  /** The last certificate that getPeerCertificate(true) links to. */
  async function rootOf(cert: string, ca: string[]) {
    await using server = await serve(cert);
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, ca, rejectUnauthorized: false });
    try {
      await once(socket, "secureConnect");
      let last = socket.getPeerCertificate(true);
      while (last.issuerCertificate && last.issuerCertificate !== last) last = last.issuerCertificate;
      return armor("CERTIFICATE", last.raw);
    } finally {
      socket.destroy();
    }
  }

  describe.each(["shorter", "longer"] as const)("a %s copy", size => {
    describe.each([
      ["is taken when it comes first", taken, undefined],
      ["is passed over", passedOver, "authorized"],
    ] as const)("%s", (_, defects, whenFirst) => {
      it.each(defects)("of the root with %s", async (defect, _extensions, _options, code) => {
        const bad = copy(defect, size);
        await using server = await serve(chain);
        expect({
          alone: await connect(server.port, { ca: [bad] }),
          last: await connect(server.port, { ca: [root, bad] }),
          first: await connect(server.port, { ca: [bad, root] }),
          lastInOneString: await connect(server.port, { ca: root + bad }),
          firstInOneString: await connect(server.port, { ca: bad + root }),
        }).toEqual({
          alone: code,
          last: "authorized",
          first: whenFirst ?? code,
          lastInOneString: "authorized",
          firstInOneString: whenFirst ?? code,
        });
      });
    });

    it.each([
      ["CA:FALSE", "INVALID_PURPOSE"],
      ["name constraints", "UNSPECIFIED"],
      ["an unknown issuer", "UNABLE_TO_GET_ISSUER_CERT"],
      ["a validity that ended", "authorized"],
    ])("of an intermediate with %s", async (defect, whenFirst) => {
      const bad = copy(defect, size, "intermediate");
      await using server = await serve(leaf);
      expect({
        last: await connect(server.port, { ca: [root, intermediate, bad] }),
        first: await connect(server.port, { ca: [root, bad, intermediate] }),
        lastAsAnchor: await connect(server.port, { ca: [intermediate, bad], allowPartialTrustChain: true }),
      }).toEqual({ last: "authorized", first: whenFirst, lastAsAnchor: "authorized" });
    });

    it("among other roots, for every connection of a context", async () => {
      const bad = copy("CA:FALSE", size);
      await using server = await serve(chain);
      const outcomes = { last: new Set<string>(), first: new Set<string>() };
      for (const at of [0, 7, 20, 33, 40]) {
        for (const [order, [a, b]] of [
          ["last", [root, bad]],
          ["first", [bad, root]],
        ] as const) {
          const secureContext = tls.createSecureContext({ ca: [...unrelated.toSpliced(at, 0, a), b] });
          for (let i = 0; i < 2; i++) outcomes[order].add(await connect(server.port, { secureContext }));
        }
      }
      expect(outcomes).toEqual({ last: new Set(["authorized"]), first: new Set(["INVALID_PURPOSE"]) });
    });

    it("with fetch", async () => {
      const bad = copy("extendedKeyUsage=clientAuth", size);
      await using server = await serve(chain);
      const get = (ca: string[]) =>
        fetch(`https://127.0.0.1:${server.port}`, { tls: { ca }, keepalive: false }).then(
          response => response.text(),
          error => error.code,
        );
      expect([await get([root, bad]), await get([bad, root])]).toEqual(["authorized", "INVALID_PURPOSE"]);
    });

    it("for the certificate of a client", async () => {
      const forServers = mint("root", "root", [...ca, eku(serverAuth)], { size });
      async function verdict(ca: string[]) {
        await using server = await serve(chain, { ca, requestCert: true, rejectUnauthorized: false });
        const accepted = once(server, "secureConnection");
        expect(await connect(server.port, { key, cert: clientChain, ca: root, maxVersion: "TLSv1.2" })).toBe(
          "authorized",
        );
        const [peer] = (await accepted) as [TLSSocket];
        return peer.authorized ? "authorized" : String(peer.authorizationError);
      }
      expect([await verdict([root, forServers]), await verdict([forServers, root])]).toEqual([
        "authorized",
        "INVALID_PURPOSE",
      ]);
    });

    it("that is revoked", async () => {
      const revoked = mint("root", "root", ca, { size });
      const crl = [crlOf("root", revoked), crlOf("intermediate")];
      expect([await verify(chain, [root, revoked], { crl }), await verify(chain, [revoked, root], { crl })]).toEqual([
        "authorized",
        "CERT_REVOKED",
      ]);
    });

    it("given to addCACert() comes after `ca`", async () => {
      const bad = copy("CA:FALSE", size);
      await using server = await serve(chain);
      const connectWith = (ca: string, added: string) => {
        const secureContext = tls.createSecureContext({ ca });
        secureContext.context.addCACert(added);
        return connect(server.port, { secureContext });
      };
      expect({
        bad: await connectWith(root, bad),
        root: await connectWith(bad, root),
        badAgain: await connectWith(root + bad, bad),
        rootAgain: await connectWith(bad + root, root),
        firstAgain: await connectWith(root + bad, root),
      }).toEqual({
        bad: "authorized",
        root: "INVALID_PURPOSE",
        badAgain: "authorized",
        rootAgain: "INVALID_PURPOSE",
        firstAgain: "authorized",
      });
    });

    it("hides the error of the one after it", async () => {
      const [a, b] = [copy("pathlen:0", size), copy("another key")];
      expect([await verify(chain, [a, b]), await verify(chain, [b, a])]).toEqual([
        "PATH_LENGTH_EXCEEDED",
        "CERT_SIGNATURE_FAILURE",
      ]);
    });

    it("in getPeerCertificate(true)", async () => {
      const valid = mint("root", "root", ca, { size });
      const [older, newer] = [mint("root", "root", ca, { size, to: "2021" }), mint("root", "root", ca, { to: "2022" })];
      expect({
        last: await rootOf(chain, [root, valid]),
        first: await rootOf(chain, [valid, root]),
        expired: await rootOf(chain, [older, root]),
        otherType: await rootOf(chain, [copy("another type of key", size), root]),
        olderFirst: await rootOf(chain, [older, newer]),
        newerFirst: await rootOf(chain, [newer, older]),
      }).toEqual({ last: root, first: valid, expired: root, otherType: root, olderFirst: newer, newerFirst: newer });
    });

    it.each([
      ["CA:FALSE", "INVALID_PURPOSE"],
      ["a validity that ended", "authorized"],
    ])("of an intermediate with %s, when a server completes its chain", async (defect, whenFirst) => {
      const bad = copy(defect, size, "intermediate");
      await using last = await serve(leaf, { ca: [intermediate, bad] });
      await using first = await serve(leaf, { ca: [bad, intermediate] });
      expect([await connect(last.port, { ca: root }), await connect(first.port, { ca: root })]).toEqual([
        "authorized",
        whenFirst,
      ]);
    });
  });

  it("with none in date, the error is of the one that expires last", async () => {
    const [ended, notBegun] = [copy("a validity that ended"), copy("a validity that has not begun")];
    expect([await verify(chain, [ended, notBegun]), await verify(chain, [notBegun, ended])]).toEqual([
      "CERT_NOT_YET_VALID",
      "CERT_NOT_YET_VALID",
    ]);
  });

  it("with no anchor but through a CA that is out of date, the error is of the path through it", async () => {
    const [ended, notBegun] = ["a validity that ended", "a validity that has not begun"];
    const ofIntermediate = (defect: string) => copy(defect, "usual", "intermediate");
    const crossSigned = copy("an unknown issuer");
    expect({
      passedOverBefore: await verify(leaf, [ofIntermediate(notBegun), intermediate, copy(ended)]),
      passedOverAndNoRoot: await verify(leaf, [ofIntermediate(ended), intermediate]),
      passedOverAndUnknownRoot: await verify(chain, [copy(ended), crossSigned]),
      twoTrusted: await verify(chain, [ofIntermediate(ended), copy(notBegun)]),
      oneTrustedOneSent: await verify(leaf + ofIntermediate(ended), [copy(notBegun)]),
      unknownRoot: await verify(chain, [ofIntermediate(ended), crossSigned]),
      sentCrossSigned: await verify(chain + crossSigned, [copy(ended)]),
      sentNotCA: await verify(chain + copy("CA:FALSE"), [copy(ended)]),
      anotherKey: await verify(chain, [
        mint("root", "root", ca, { to: "2021", subjectKey: otherKey, signer: otherKey }),
      ]),
      crl: await verify(chain, [copy(ended)], { crl: [crlOf("root"), crlOf("intermediate")] }),
      loop: await verify(chain, [mint("root", "other", ca), mint("other", "root", ca, { to: "2021" })]),
    }).toEqual({
      passedOverBefore: "CERT_HAS_EXPIRED",
      passedOverAndNoRoot: "UNABLE_TO_GET_ISSUER_CERT",
      passedOverAndUnknownRoot: "UNABLE_TO_GET_ISSUER_CERT",
      twoTrusted: "CERT_HAS_EXPIRED",
      oneTrustedOneSent: "CERT_HAS_EXPIRED",
      unknownRoot: "CERT_HAS_EXPIRED",
      sentCrossSigned: "CERT_HAS_EXPIRED",
      sentNotCA: "CERT_HAS_EXPIRED",
      anotherKey: "CERT_SIGNATURE_FAILURE",
      crl: "CERT_HAS_EXPIRED",
      loop: "CERT_HAS_EXPIRED",
    });
  });

  it("the same goes for the certificates a server sends", async () => {
    const otherType = mint("intermediate", "root", ca, { subjectKey: ed25519Key });
    expect({
      expired: await verify(leaf + copy("a validity that ended", "usual", "intermediate") + intermediate, [root]),
      otherType: await verify(leaf + otherType + intermediate, [root]),
      notCA: await verify(leaf + copy("CA:FALSE", "usual", "intermediate") + intermediate, [root]),
    }).toEqual({ expired: "authorized", otherType: "authorized", notCA: "INVALID_PURPOSE" });
  });

  it("a bundled root comes before one given to addCACert()", async () => {
    const name = seq(
      rdn("550406", "US"),
      rdn("55040a", "Internet Security Research Group"),
      rdn("550403", "ISRG Root X2"),
    );
    const sameName = mint(name, name, ca);
    await using server = await serve(leafOf(name));
    const secureContext = tls.createSecureContext();
    secureContext.context.addCACert(sameName);
    expect([await connect(server.port, { ca: sameName }), await connect(server.port, { secureContext })]).toEqual([
      "authorized",
      "CERT_SIGNATURE_FAILURE",
    ]);
  });

  it("key identifiers have to match", async () => {
    const issued = leaf + mint("intermediate", "root", [...ca, authorityKeyId("01")]);
    const current = mint("root", "root", [...ca, subjectKeyId("01")]);
    const other = mint("root", "root", [...ca, subjectKeyId("02")], { subjectKey: otherKey, signer: otherKey });
    expect([await verify(issued, [other]), await verify(issued, [other, current])]).toEqual([
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "authorized",
    ]);
  });

  it("a root that a key of another type certified is not self-signed", async () => {
    const link = mint("root", "root", ca, { signer: ed25519Key });
    const previous = copy("another type of key");
    expect({
      sent: await verify(chain + link, [previous]),
      trusted: await verify(chain, [link, previous]),
      trustedAlone: await verify(chain, [link]),
      checkIssued: [link, previous].map(issuer => new X509Certificate(link).checkIssued(new X509Certificate(issuer))),
    }).toEqual({
      sent: "authorized",
      trusted: "authorized",
      trustedAlone: "UNABLE_TO_GET_ISSUER_CERT",
      checkIssued: [false, true],
    });
  });

  it("an RSA-PSS key can have made an RSA-PSS signature", () => {
    const pem = readFileSync(join(import.meta.dir, "../test/fixtures/keys/rsa_pss_public_2048.pem"), "utf8");
    const spki = Buffer.from(pem.replace(/-----.*-----/g, ""), "base64");
    const pss = seq(oid("2a864886f70d01010a"), seq());
    const validity = seq(time("20200101000000Z"), time("21200101000000Z"));
    const tbs = seq(hex("a003020102020101"), pss, dn("pss"), validity, dn("pss"), spki);
    const cert = new X509Certificate(seq(tbs, pss, tlv(0x03, hex("0000"))));
    expect(cert.checkIssued(cert)).toBe(true);
  });

  it("a server names the CAs it accepts in the order of `ca`", async () => {
    const names = ["a long name for a CA", "short", "a medium name", "short"];
    const cas = names.map(name => mint(name, name, ca));
    await using server = await serve(chain, { ca: [...cas, cas[0]], requestCert: true, rejectUnauthorized: false });
    const received: Buffer[] = [];
    const transport = net.connect(server.port, "127.0.0.1").on("data", chunk => received.push(chunk as Buffer));
    const socket = new Duplex({
      read() {},
      write: (chunk, encoding, callback) => void transport.write(chunk, encoding, callback),
    });
    transport
      .on("data", chunk => socket.push(chunk))
      .on("error", error => socket.destroy(error))
      .on("close", () => socket.push(null));
    try {
      expect(await connect(server.port, { socket, ca: root, maxVersion: "TLSv1.2" })).toBe("authorized");
    } finally {
      transport.destroy();
    }
    const text = Buffer.concat(received).toString("latin1");
    expect(text.match(new RegExp(names.join("|"), "g"))).toEqual([...names, names[0]] as RegExpMatchArray);
  });

  // OpenSSL takes it, though its manual asks for "a certificate with suitable key usage".
  it("a copy that may not sign certificates is passed over, unlike in Node.js", async () => {
    expect(await verify(chain, [mint("root", "root", [isCA, digitalSignature]), root])).toBe("authorized");
  });

  describe("a self-issued certificate", () => {
    const selfSigned = (extensions: Buffer[], options?: Options) =>
      mint("self", "self", [...extensions, localhost], { subjectKey: leafKey, signer: leafKey, ...options });

    describe.each([
      ["CA:FALSE", [notCA]],
      ["keyUsage=digitalSignature", [notCA, digitalSignature]],
      ["CA:TRUE", [isCA]],
    ])("with %s is trusted when `ca` holds it", (_, extensions) => {
      it.each(["before another of that subject", "after another of that subject, unlike in Node.js"])(
        "%s",
        async order => {
          const pinned = selfSigned(extensions);
          await using server = await serve(pinned);
          const outcomes = new Set<string>();
          for (const other of [
            selfSigned([isCA]),
            selfSigned([notCA]),
            selfSigned([isCA], { subjectKey: otherKey, signer: otherKey }),
          ]) {
            const ca = order.startsWith("before") ? [pinned, other] : [other, pinned];
            outcomes.add(await connect(server.port, { ca }));
          }
          expect([...outcomes]).toEqual(["authorized"]);
        },
      );
    });

    it("that another key signed needs its issuer", async () => {
      const issuer = mint("self", "self", [...ca, subjectKeyId("01")]);
      const extensions = [notCA, digitalSignature, subjectKeyId("02"), authorityKeyId("01")];
      const issued = selfSigned(extensions, { signer: caKey });
      expect([await verify(issued, [issued]), await verify(issued, [issued, issuer])]).toEqual([
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "authorized",
      ]);
    });

    it("that `ca` holds is checked without the CA of the same name that issued it", async () => {
      const issued = selfSigned([notCA, digitalSignature], { signer: caKey });
      const constrained = mint("self", "self", [...ca, permitOnlyExampleCom]);
      expect([
        await verify(issued, [issued, constrained]),
        await verify(issued, [issued, mint("self", "self", ca)], { crl: crlOf("self") }),
      ]).toEqual(["authorized", "CRL_SIGNATURE_FAILURE"]);
    });

    // OpenSSL calls it self-signed without looking at the signature.
    it("that a CA of the same name issued is valid, unlike in Node.js", async () => {
      const issued = selfSigned([notCA, digitalSignature], { signer: caKey });
      expect(await verify(issued, [mint("self", "self", ca)])).toBe("authorized");
    });
  });

  describe.concurrent("in the default store", () => {
    type Source = "NODE_EXTRA_CA_CERTS" | "SSL_CERT_FILE";
    const good = (name: string) => mint(name, name, ca);
    const bad = (name: string) => copy("CA:FALSE", "usual", name, name);

    /** Each case has a root name of its own, so that one process holds them all. */
    async function run(
      args: string[],
      cases: Record<string, (name: string) => Partial<Record<Source, string[]>>>,
      main = "main.mjs",
    ) {
      const files = { NODE_EXTRA_CA_CERTS: unrelated.slice(0, 20), SSL_CERT_FILE: unrelated.slice(20) };
      const chains: Record<string, string> = {};
      for (const [name, sources] of Object.entries(cases)) {
        chains[name] = leaf + mint("intermediate", name, ca);
        for (const [source, [first, ...rest]] of Object.entries(sources(name)) as [Source, string[]][]) {
          files[source] = [first, ...files[source], ...rest];
        }
      }
      using dir = tempDir("same-subject", {
        "extra.pem": files.NODE_EXTRA_CA_CERTS.join(""),
        "file.pem": files.SSL_CERT_FILE.join(""),
        "plan.json": JSON.stringify({ key, chains }),
        "main.mjs": `
          import { once } from "node:events";
          import { readFileSync } from "node:fs";
          import https from "node:https";
          import tls from "node:tls";
          const { key, chains } = JSON.parse(readFileSync("plan.json", "utf8"));
          const outcomes = {};
          for (const [name, cert] of Object.entries(chains)) {
            const server = https.createServer({ key, cert }, (_, response) => response.end("authorized"));
            await once(server.listen(0, "127.0.0.1"), "listening");
            const { port } = server.address();
            const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost" });
            outcomes[name] = [
              await once(socket, "secureConnect").then(() => "authorized", error => error.code),
              await fetch("https://127.0.0.1:" + port).then(res => res.text(), error => error.code ?? error.cause.code),
            ];
          }
          console.log(JSON.stringify(outcomes));
          process.exit(0);
        `,
        "http3.mjs": `
          const { key, chains } = await Bun.file("plan.json").json();
          const outcomes = {};
          for (const [name, cert] of Object.entries(chains)) {
            const fetch = () => new Response("authorized");
            using server = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { key, cert }, http3: true, fetch });
            outcomes[name] = await globalThis
              .fetch(server.url, { protocol: "http3" })
              .then(res => res.text(), error => error.code);
          }
          console.log(JSON.stringify(outcomes));
          process.exit(0);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args, main],
        cwd: String(dir),
        env: {
          ...bunEnv,
          NODE_USE_SYSTEM_CA: undefined,
          NODE_EXTRA_CA_CERTS: join(String(dir), "extra.pem"),
          SSL_CERT_FILE: join(String(dir), "file.pem"),
          SSL_CERT_DIR: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      return { outcomes: JSON.parse(stdout), exitCode };
    }
    const authorized = ["authorized", "authorized"];
    const notACA = ["INVALID_PURPOSE", "INVALID_PURPOSE"];
    const repeat = <T>(label: string, value: T) =>
      Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`${label} ${i}`, value]));
    const across = {
      "good in extra": (name: string) => ({ NODE_EXTRA_CA_CERTS: [good(name)], SSL_CERT_FILE: [bad(name)] }),
      "good in file": (name: string) => ({ NODE_EXTRA_CA_CERTS: [bad(name)], SSL_CERT_FILE: [good(name)] }),
    };

    it.each([
      ["NODE_EXTRA_CA_CERTS", []],
      ["SSL_CERT_FILE", ["--use-openssl-ca"]],
    ] as const)("the order of %s is kept", async (source, args) => {
      expect(
        await run([...args], {
          ...repeat("last", (name: string) => ({ [source]: [good(name), bad(name)] })),
          ...repeat("first", (name: string) => ({ [source]: [bad(name), good(name)] })),
        }),
      ).toEqual({ outcomes: { ...repeat("last", authorized), ...repeat("first", notACA) }, exitCode: 0 });
    });

    it("NODE_EXTRA_CA_CERTS comes before SSL_CERT_FILE", async () => {
      expect(await run([], across)).toEqual({
        outcomes: { "good in extra": authorized, "good in file": notACA },
        exitCode: 0,
      });
    });

    it("HTTP/3 has the same order", async () => {
      expect(await run(["--use-openssl-ca"], across, "http3.mjs")).toEqual({
        outcomes: { "good in extra": "HTTP3HandshakeFailed", "good in file": "authorized" },
        exitCode: 0,
      });
    });

    it("HTTP/3 refuses a root that is out of date", async () => {
      const expired = (name: string) => ({ NODE_EXTRA_CA_CERTS: [mint(name, name, ca, { to: "2021" })] });
      expect(await run([], { expired }, "http3.mjs")).toEqual({
        outcomes: { expired: "HTTP3HandshakeFailed" },
        exitCode: 0,
      });
    });

    // Elsewhere the system store is not made of files.
    it.each(isLinux ? ["--use-openssl-ca", "--use-system-ca"] : ["--use-openssl-ca"])(
      "NODE_EXTRA_CA_CERTS comes last with %s",
      async flag => {
        expect(await run([flag], across)).toEqual({
          outcomes: { "good in extra": notACA, "good in file": authorized },
          exitCode: 0,
        });
      },
    );

    it("a copy that does not parse is passed over", async () => {
      const cases = {
        broken: (name: string) => ({ SSL_CERT_FILE: [mint(name, name, ca, { to: "21XX" }), good(name)] }),
      };
      expect(await run(["--use-openssl-ca"], cases)).toEqual({ outcomes: { broken: authorized }, exitCode: 0 });
    });

    async function sentWith(...extra: string[]) {
      using dir = tempDir("auto-chain", { "extra.pem": extra.join("") });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const tls = require("node:tls");
          const server = tls.createServer(${JSON.stringify({ key, cert: leaf })}).listen(0, "127.0.0.1", () => {
            const options = { ca: ${JSON.stringify(unrelated[0])}, rejectUnauthorized: false };
            const socket = tls.connect(server.address().port, "127.0.0.1", options, () => {
              let count = 0;
              for (let cert = socket.getPeerX509Certificate(); cert; cert = cert.issuerCertificate) count++;
              console.log(count);
              process.exit(0);
            });
          });`,
        ],
        env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "extra.pem") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    it("a server completes its chain with a CA that is out of date if there is no other", async () => {
      expect(await sentWith(copy("a validity that ended", "usual", "intermediate"), root)).toEqual({
        stdout: "3\n",
        stderr: "",
        exitCode: 0,
      });
    });

    it.each(["2021", "2120"])(
      "a server goes round CAs that certify each other until %s only once, unlike in Node.js",
      async to => {
        expect(await sentWith(intermediate, mint("root", "other", ca, { to }), mint("other", "root", ca))).toEqual({
          stdout: "5\n",
          stderr: "",
          exitCode: 0,
        });
      },
    );

    it("a plain copy does not lift the trust settings of a certificate, unlike in Node.js", async () => {
      const rejected = (pem: string) =>
        armor("TRUSTED CERTIFICATE", Buffer.concat([new X509Certificate(pem).raw, seq(tlv(0xa0, serverAuth))]));
      const plainAndRejected = (name: string) => {
        const pem = good(name);
        return { SSL_CERT_FILE: [pem, rejected(pem)] };
      };
      expect(await run(["--use-openssl-ca"], { plainAndRejected })).toEqual({
        outcomes: { plainAndRejected: ["UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT"] },
        exitCode: 0,
      });
    });
  });
});
