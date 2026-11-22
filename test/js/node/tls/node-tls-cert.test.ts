import { describe, expect, it } from "bun:test";
import { once } from "events";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tls as harnessCert, invalidTls, isLinux, tempDir, tmpdirSync } from "harness";
import {
  createCipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import type { Server, TLSSocket } from "node:tls";
import { join, sep } from "path";
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

it('Confirm client support for "BEGIN TRUSTED CERTIFICATE".', async () => {
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

it('Confirm server support for "BEGIN TRUSTED CERTIFICATE".', async () => {
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

it("tls.connect should use NODE_EXTRA_CA_CERTS up to an invalid cert", async () => {
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

  for (const { stderr } of results) {
    expect(stderr).toContain("Warning: Ignoring extra certs from");
  }
  expect(results.map(result => result.exitCode)).toEqual([1, 0]);
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

  it("a CA with a malformed validity field is neither an anchor nor in the way", async () => {
    const der = Buffer.from(F["int-valid"].replace(/-----[^\n]+-----|\s/g, ""), "base64");
    // notBefore is a 13-byte UTCTime (tag 0x17, length 0x0d); corrupt one of its digits.
    const notBefore = der.indexOf(Buffer.from([0x17, 0x0d]));
    expect(notBefore).toBeGreaterThan(0);
    const bad = Buffer.from(der);
    bad[notBefore + 2] = 0x58; // 'X'
    const pem = `-----BEGIN CERTIFICATE-----\n${bad.toString("base64")}\n-----END CERTIFICATE-----\n`;
    expect([
      await connect(F.leaf, [pem], { allowPartialTrustChain: true }),
      await connect(F.leaf + F["int-valid"], [pem, F.root]),
    ]).toEqual(["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "authorized"]);
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
  const utcTime = (text: string) => tlv(0x17, Buffer.from(text));
  const rdn = (type: string, value: string) => tlv(0x31, seq(oid(type), tlv(0x0c, Buffer.from(value))));
  type Name = string | Buffer;
  const dn = (name: Name) => (typeof name === "string" ? seq(rdn("550403", name)) : name);
  const extension = (id: string, value: Buffer, critical = false) =>
    seq(oid(id), hex(critical ? "0101ff" : ""), tlv(0x04, value));
  const armor = (label: string, der: Buffer) =>
    `-----BEGIN ${label}-----\n${der.toString("base64").replace(/.{64}(?!$)/g, "$&\n")}\n-----END ${label}-----\n`;
  type KeyPair = { publicKey: KeyObject; privateKey: KeyObject };
  const algorithms: Record<string, Buffer> = {
    ec: seq(oid("2a8648ce3d040302")),
    ed25519: seq(oid("2b6570")),
    rsa: seq(oid("2a864886f70d01010b"), hex("0500")),
  };
  const algorithm = ({ privateKey }: KeyPair) => algorithms[privateKey.asymmetricKeyType!];
  const digest = ({ privateKey }: KeyPair) => (privateKey.asymmetricKeyType === "ed25519" ? null : "sha256");
  const signed = (tbs: Buffer, signer: KeyPair) =>
    seq(tbs, algorithm(signer), tlv(0x03, hex("00"), sign(digest(signer), tbs, signer.privateKey)));

  const [serverAuth, clientAuth] = ["01", "02"].map(n => oid(`2b060105050703${n}`));
  const isCA = extension("551d13", seq(hex("0101ff")), true);
  const notCA = extension("551d13", seq(), true);
  const pathLen0 = extension("551d13", seq(hex("0101ff020100")), true);
  const keyCertSign = extension("551d0f", hex("03020106"), true); // and cRLSign
  const digitalSignature = extension("551d0f", hex("03020780"), true);
  const eku = (purpose: Buffer) => extension("551d25", seq(purpose));
  const unknownCritical = extension("2a0304", hex("0500"), true);
  const permitOnlyExampleCom = extension("551d1e", seq(tlv(0xa0, seq(tlv(0x82, Buffer.from("example.com"))))), true);
  const netscapeTypes = { client: "0780", server: "0640", sslCA: "0204", mailCA: "0102" };
  const netscapeType = (type: keyof typeof netscapeTypes, critical = false) =>
    extension("6086480186f8420101", tlv(0x03, hex(netscapeTypes[type])), critical);
  const subjectKeyId = (id: string) => extension("551d0e", tlv(0x04, hex(id)));
  const authorityKeyId = (id: string) => extension("551d23", seq(tlv(0x80, hex(id))));
  const localhost = extension("551d11", seq(tlv(0x82, Buffer.from("localhost")), tlv(0x87, hex("7f000001"))));
  const ca = [isCA, keyCertSign];

  const [caKey, otherKey, leafKey] = [0, 1, 2].map(() => generateKeyPairSync("ec", { namedCurve: "prime256v1" }));
  const ed25519Key = generateKeyPairSync("ed25519");
  const key = leafKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const padding = { shorter: 1, usual: 100, longer: 200 };
  type Size = keyof typeof padding;
  type Options = {
    size?: Size;
    subjectKey?: KeyPair;
    signer?: KeyPair;
    issuer?: string;
    from?: string;
    to?: string;
    v1?: boolean;
  };

  let serial = 0x100;
  function mint(subject: Name, issuedBy: Name, extensions: Buffer[], options: Options = {}) {
    const { size = "usual", subjectKey = caKey, signer = caKey, issuer = issuedBy } = options;
    const tbs = seq(
      hex(options.v1 ? "" : "a003020102"),
      tlv(0x02, hex((serial++).toString(16).padStart(4, "0"))),
      algorithm(signer),
      dn(issuer),
      seq(time(`${options.from ?? "2020"}0101000000Z`), time(`${options.to ?? "2120"}0101000000Z`)),
      dn(subject),
      subjectKey.publicKey.export({ type: "spki", format: "der" }),
      options.v1 ? hex("") : tlv(0xa3, seq(...extensions, extension("2a0305", tlv(0x04, Buffer.alloc(padding[size]))))),
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

  const derOf = (pem: string) => Buffer.from(pem.replace(/-----.*-----/g, ""), "base64");
  const contentsOf = (element: Buffer) => element.subarray(element[1] < 0x80 ? 2 : 2 + (element[1] & 0x7f));
  /** With more bytes for the length than it takes. */
  function longForm(element: Buffer) {
    const { length } = contentsOf(element);
    return Buffer.concat([Buffer.from([element[0], 0x83, 0, length >> 8, length & 0xff]), contentsOf(element)]);
  }
  const indefinite = (element: Buffer) =>
    Buffer.concat([Buffer.from([element[0], 0x80]), contentsOf(element), hex("0000")]);
  function elementsOf(der: Buffer) {
    const fields: Buffer[] = [];
    for (let rest = contentsOf(der); rest.length; rest = rest.subarray(fields.at(-1)!.length)) {
      const header = rest[1] < 0x80 ? 2 : 2 + (rest[1] & 0x7f);
      fields.push(rest.subarray(0, header + (header === 2 ? rest[1] : rest.readUIntBE(2, header - 2))));
    }
    return fields;
  }
  /** The fields of a certificate or CRL. */
  const fieldsOf = (pem: string) => elementsOf(derOf(pem));
  function encrypted(pem: string, passphrase: string) {
    const iv = Buffer.alloc(16, 1);
    const key = createHash("md5").update(passphrase).update(iv.subarray(0, 8)).digest();
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const [label] = pem.match(/(?<=BEGIN ).*(?=-----)/)!;
    return armor(label, Buffer.concat([cipher.update(derOf(pem)), cipher.final()])).replace(
      "\n",
      `\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,${iv.toString("hex")}\n\n`,
    );
  }
  const byteOrderMark = "\ufeff";

  const trustOnly = (purpose: Buffer) => seq(seq(purpose));
  const reject = (purpose: Buffer) => seq(tlv(0xa0, purpose));
  const withSettings = (pem: string, settings: Buffer, label = "TRUSTED CERTIFICATE") =>
    armor(label, Buffer.concat([new X509Certificate(pem).raw, settings]));

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
    ["a Netscape type for e-mail", [netscapeType("mailCA")], {}, "INVALID_PURPOSE"],
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
  async function verify(cert: string, ca: string | string[], options?: tls.ConnectionOptions) {
    await using server = await serve(cert);
    return await connect(server.port, { ca, ...options });
  }
  async function verifyClient(cert: string, ca: string | string[], options?: tls.ConnectionOptions) {
    await using server = await serve(chain, { ca, requestCert: true, rejectUnauthorized: false });
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, key, cert, ca: root, ...options });
    try {
      const [[peer]] = await Promise.all([once(server, "secureConnection"), once(socket, "secureConnect")]);
      return peer.authorized ? "authorized" : String(peer.authorizationError);
    } finally {
      socket.destroy();
    }
  }
  /** The certificates that getPeerCertificate(true) links. */
  async function linked(cert: string, ca: string[]) {
    await using server = await serve(cert);
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, ca, rejectUnauthorized: false });
    try {
      await once(socket, "secureConnect");
      const certs = new Set<tls.DetailedPeerCertificate>();
      for (let cert = socket.getPeerCertificate(true); cert && !certs.has(cert); cert = cert.issuerCertificate) {
        certs.add(cert);
      }
      return [...certs].map(cert => armor("CERTIFICATE", cert.raw));
    } finally {
      socket.destroy();
    }
  }
  const rootOf = async (cert: string, ca: string[]) => (await linked(cert, ca)).at(-1);

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
      expect([
        await verifyClient(clientChain, [root, forServers]),
        await verifyClient(clientChain, [forServers, root]),
      ]).toEqual(["authorized", "INVALID_PURPOSE"]);
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

  describe("a server names the CAs it accepts", () => {
    const requestCert = { requestCert: true, rejectUnauthorized: false };
    async function named(options: tls.TlsOptions) {
      await using server = await serve(chain, { ...requestCert, ...options });
      return await namedBy(server);
    }
    async function namedBy(server: { port: number }): Promise<string[] | null> {
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
        const ciphers = "ECDHE-ECDSA-AES128-GCM-SHA256";
        expect(await connect(server.port, { socket, ca: root, maxVersion: "TLSv1.2", ciphers })).toBe("authorized");
      } finally {
        transport.destroy();
      }
      const text = Buffer.concat(received).toString("latin1");
      return text.match(new RegExp([...names, "Joyent"].join("|"), "g"));
    }
    const names = ["a long name for a CA", "short", "a medium name"];
    const cas = names.map(name => mint(name, name, ca));

    it("in the order of `ca`", async () => {
      expect(await named({ ca: cas })).toEqual(names);
    });

    it("once each, unlike in Node.js", async () => {
      expect(await named({ ca: [...cas, mint(names[1], names[1], ca), cas[0]] })).toEqual(names);
    });

    it("then those given to addCACert()", async () => {
      const secureContext = tls.createSecureContext({ key, cert: chain, ca: cas[0] });
      secureContext.context.addCACert(cas[1] + cas[2]);
      await using server = net.createServer(socket => {
        new tls.TLSSocket(socket, { isServer: true, secureContext, ...requestCert }).on("error", () => {}).resume();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      expect(await namedBy(server.address() as AddressInfo)).toEqual(names);
    });

    it("but not those of setDefaultCACertificates()", async () => {
      const before = tls.getCACertificates("default");
      tls.setDefaultCACertificates(cas);
      try {
        await using server = tls.createServer({ key, cert: chain, ...requestCert });
        // The contexts of these are shared between equal options, while in use.
        const sockets: tls.TLSSocket[] = [];
        await using wrapping = net.createServer(socket => {
          const ca = sockets.length ? tls.getCACertificates("default") : undefined;
          const options = { isServer: true, key, cert: chain, ca, ...requestCert };
          sockets.push(new tls.TLSSocket(socket, options).on("error", () => {}).resume());
        });
        await Promise.all([server, wrapping].map(server => once(server.listen(0, "127.0.0.1"), "listening")));
        expect({
          https: await named({}),
          tls: await namedBy(server.address() as AddressInfo),
          socket: await namedBy(wrapping.address() as AddressInfo),
          socketWithCa: (await namedBy(wrapping.address() as AddressInfo))?.length,
        }).toEqual({ https: null, tls: null, socket: null, socketWithCa: names.length });
      } finally {
        tls.setDefaultCACertificates(before);
      }
    });

    it("even next to those in a pfx", async () => {
      const pfx = readFileSync(join(import.meta.dir, "../test/fixtures/keys/agent1.pfx"));
      const before = tls.getCACertificates("default");
      tls.setDefaultCACertificates(cas.slice(1));
      try {
        await using server = tls.createServer({ key, cert: chain, pfx, passphrase: "sample", ...requestCert });
        await once(server.listen(0, "127.0.0.1"), "listening");
        expect({
          https: await named({ pfx, passphrase: "sample" }),
          httpsWithCa: await named({ pfx, passphrase: "sample", ca: cas[0] }),
          tls: await namedBy(server.address() as AddressInfo),
        }).toEqual({ https: ["Joyent"], httpsWithCa: [names[0], "Joyent"], tls: ["Joyent"] });
      } finally {
        tls.setDefaultCACertificates(before);
      }
    });

    it("from caFile", async () => {
      const file = [cas[0], crlOf("root"), withSettings(cas[1], seq()), cas[2], mint(names[1], names[1], ca)];
      using dir = tempDir("named-ca", { "ca.pem": file.join("") });
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key, cert: chain, caFile: join(String(dir), "ca.pem"), ...requestCert } as Bun.TLSOptions,
        socket: { data() {} },
      });
      expect(await namedBy(listener)).toEqual(names);
    });

    it("so repeating them does not take more than the 64 KB they have, unlike in Node.js", async () => {
      const long = Buffer.alloc(1000, "a").toString();
      const repeated = Array(70)
        .fill(mint(long, long, ca))
        .join("");
      using dir = tempDir("repeated-ca", { "ca.pem": repeated + mint(long, long, ca) });
      const outcomes: string[] = [];
      for (const options of [{ ca: repeated }, { caFile: join(String(dir), "ca.pem") }]) {
        using listener = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          tls: { key, cert: chain, ...requestCert, ...options },
          socket: { data() {} },
        });
        outcomes.push(await connect(listener.port, { ca: root }));
      }
      expect(outcomes).toEqual(["authorized", "authorized"]);
    });
  });

  // OpenSSL takes it, though its manual asks for "a certificate with suitable key usage".
  it("a copy that may not sign certificates is passed over, unlike in Node.js", async () => {
    const mayNotSign = mint("root", "root", [isCA, digitalSignature]);
    expect(await verify(chain, [mayNotSign, root])).toBe("authorized");
    expect(await rootOf(chain, [mayNotSign, root])).toBe(root);
  });

  it("a copy that may not sign certificates gives the error when there is no other path", async () => {
    const mayNotSign = mint("root", "root", [isCA, digitalSignature]);
    expect({
      alone: await verify(chain, [mayNotSign]),
      beforeOneThatExpired: await verify(chain, [mayNotSign, copy("a validity that ended")]),
      beforeOneOfAnotherKey: await verify(chain, [mayNotSign, copy("another key")]),
      sent: await verify(leaf + mint("intermediate", "root", [isCA, digitalSignature]), [root]),
    }).toEqual({
      alone: "UNSPECIFIED",
      beforeOneThatExpired: "UNSPECIFIED",
      beforeOneOfAnotherKey: "UNSPECIFIED",
      sent: "UNSPECIFIED",
    });
    expect(await rootOf(chain, [copy("a validity that ended"), mayNotSign])).toBe(mayNotSign);
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

    it("that may not sign certificates is self-signed all the same", async () => {
      const pinned = selfSigned([notCA, digitalSignature]);
      expect({
        unknown: await verify(pinned, [root]),
        sameKey: await verify(pinned, [selfSigned([isCA])]),
        linked: await linked(pinned, [pinned, selfSigned([isCA])]),
      }).toEqual({
        unknown: "DEPTH_ZERO_SELF_SIGNED_CERT",
        sameKey: "DEPTH_ZERO_SELF_SIGNED_CERT",
        linked: [pinned, pinned, pinned],
      });
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

  describe("trust settings", () => {
    const anyPurpose = oid("551d2500");

    it.each([
      ["none", hex(""), "authorized", "authorized"],
      ["trusted for servers", trustOnly(serverAuth), "authorized", "INVALID_PURPOSE"],
      ["trusted for clients", trustOnly(clientAuth), "INVALID_PURPOSE", "authorized"],
      ["trusted for anything", trustOnly(anyPurpose), "authorized", "authorized"],
      ["rejected for servers", reject(serverAuth), "INVALID_PURPOSE", "authorized"],
      ["rejected for clients", reject(clientAuth), "authorized", "INVALID_PURPOSE"],
      ["rejected for anything", reject(anyPurpose), "INVALID_PURPOSE", "INVALID_PURPOSE"],
    ])("of a root: %s", async (_, settings, server, client) => {
      const trusted = withSettings(root, settings);
      const secureContext = tls.createSecureContext();
      secureContext.context.addCACert(trusted);
      expect({
        ca: await verify(chain, trusted),
        plainLabel: await verify(chain, withSettings(root, settings, "CERTIFICATE")),
        addCACert: await verify(chain, [], { secureContext }),
        client: await verifyClient(clientChain, trusted),
      }).toEqual({ ca: server, plainLabel: server, addCACert: server, client });
    });

    it.each([
      ["an alias that is not UTF-8", (uses: Buffer) => seq(uses, hex("0c01e9"))],
      ["a key identifier in pieces", (uses: Buffer) => seq(uses, hex("0c01e9"), hex("2406040101040102"))],
      ["other algorithms", (uses: Buffer) => seq(uses, tlv(0xa1, algorithms.ec, algorithms.rsa))],
      ["a length that is not minimal", (uses: Buffer) => Buffer.concat([hex("3081"), seq(uses).subarray(1)])],
      ["an indefinite length", (uses: Buffer) => Buffer.concat([hex("3080"), uses, hex("0000")])],
      [
        "a list that is not tagged as constructed",
        (uses: Buffer) => seq(hex(uses[0] === 0x30 ? "10" : "80"), uses.subarray(1)),
      ],
    ])("with %s", async (_, settings) => {
      await using server = await serve(chain);
      const outcomes = (uses: Buffer) => {
        const secureContext = tls.createSecureContext({ ca: [] });
        secureContext.context.addCACert(withSettings(root, settings(uses)));
        return Promise.all([
          connect(server.port, { ca: withSettings(root, settings(uses)) }),
          connect(server.port, { secureContext }),
        ]);
      };
      expect({
        trusted: await outcomes(seq(clientAuth, serverAuth)),
        trustedForClients: await outcomes(seq(clientAuth)),
        trustedForNothing: await outcomes(seq()),
        rejected: await outcomes(tlv(0xa0, clientAuth, serverAuth)),
        rejectedForClients: await outcomes(tlv(0xa0, clientAuth)),
        both: await outcomes(Buffer.concat([seq(serverAuth), tlv(0xa0, serverAuth)])),
      }).toEqual({
        trusted: ["authorized", "authorized"],
        trustedForClients: ["INVALID_PURPOSE", "INVALID_PURPOSE"],
        trustedForNothing: ["INVALID_PURPOSE", "INVALID_PURPOSE"],
        rejected: ["INVALID_PURPOSE", "INVALID_PURPOSE"],
        rejectedForClients: ["authorized", "authorized"],
        both: ["INVALID_PURPOSE", "INVALID_PURPOSE"],
      });
    });

    it("that are malformed end the string they are in", async () => {
      await using server = await serve(chain);
      const malformed = {
        "a line feed": hex("0a"),
        "not tagged as constructed": tlv(0x10, seq(serverAuth)),
        "an unknown field": seq(hex("020101")),
        "out of order": seq(tlv(0xa0, serverAuth), seq(serverAuth)),
        "a trusted use that is no OID": seq(seq(hex("0500"))),
        "a rejected use that is no OID": seq(tlv(0xa0, hex("0500"))),
        "an alias after the key identifier": seq(hex("040101"), hex("0c0141")),
        "other algorithms that are not": seq(tlv(0xa1, hex("0500"))),
        "other algorithms with another tag": seq(tlv(0xa2, algorithms.ec)),
        "no end of contents": Buffer.concat([hex("3080"), seq(serverAuth)]),
      };
      const outcomes: Record<string, string> = {};
      for (const [name, settings] of Object.entries(malformed)) {
        outcomes[name] = await connect(server.port, { ca: withSettings(unrelated[0], settings) + root });
      }
      expect(outcomes).toEqual(
        Object.fromEntries(Object.keys(malformed).map(name => [name, "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"])),
      );
    });

    it("are read after a certificate that does not parse", async () => {
      const rejected = withSettings(intermediate, reject(serverAuth));
      const broken = derOf(mint("other", "other", ca, { to: "21XX" }));
      expect([
        await verify(chain, root + armor("CERTIFICATE", broken) + rejected),
        await verify(chain, root + armor("TRUSTED CERTIFICATE", Buffer.concat([broken, seq()])) + rejected),
        await verify(chain, root + mint(seq(hex("3100")), "root", ca) + rejected),
      ]).toEqual(["INVALID_PURPOSE", "INVALID_PURPOSE", "INVALID_PURPOSE"]);
    });

    describe("of a certificate that BoringSSL does not parse", () => {
      const names = ["version", "serial", "algorithm", "issuer", "validity", "subject", "key", "extensions"] as const;
      type Fields = Record<(typeof names)[number], Buffer>;
      const [tbs] = fieldsOf(root);
      const fields = Object.fromEntries(elementsOf(tbs).map((field, i) => [names[i], field])) as Fields;
      const changed = (changes: Partial<Fields>) => seq(...Object.values({ ...fields, ...changes }));
      const inPieces = (tag: number, body: Buffer) =>
        tlv(tag | 0x20, tlv(0x04, body.subarray(0, 2)), tlv(0x04, body.subarray(2)));
      const [keyAlgorithm, keyBits] = elementsOf(fields.key);
      const none = hex("");
      const extended = (...more: Buffer[]) => longForm(changed({ extensions: tlv(0xa3, seq(...ca, ...more)) }));
      const unknown = (critical: string) => seq(oid("2a0304"), hex(critical), hex("0400"));
      const valid = (from: string, to: string) => changed({ validity: seq(time(from), time(to)) });
      const otherRoot = mint("other root", "other root", ca);

      async function outcomes(tbs: Buffer) {
        await using server = await serve(chain + mint("root", "other root", ca));
        const entry = (settings: Buffer) => armor("TRUSTED CERTIFICATE", Buffer.concat([signed(tbs, caKey), settings]));
        const secureContext = tls.createSecureContext({ ca: otherRoot });
        secureContext.context.addCACert(entry(reject(serverAuth)));
        return {
          rejected: await connect(server.port, { ca: otherRoot + entry(reject(serverAuth)) }),
          added: await connect(server.port, { secureContext }),
          forClients: await connect(server.port, { ca: entry(trustOnly(clientAuth)) + otherRoot }),
          forNothing: await connect(server.port, { ca: entry(seq(seq())) + otherRoot }),
          trusted: await connect(server.port, { ca: entry(trustOnly(serverAuth)) }),
        };
      }
      const all = (refused: string, trusted: string) => ({
        rejected: refused,
        added: refused,
        forClients: refused,
        forNothing: refused,
        trusted,
      });

      it.each<[string, Buffer, string?, string?]>([
        ["a long form", longForm(tbs)],
        ["an indefinite length", indefinite(tbs)],
        ["a low tag in the long form", Buffer.concat([hex("3f10"), tbs.subarray(1)])],
        ...names.map((name): [string, Buffer] => [`${name}: a long form`, changed({ [name]: longForm(fields[name]) })]),
        ["an empty RDN in the issuer", changed({ issuer: seq(rdn("550403", "root"), hex("3100")) })],
        ["an empty RDN in the subject", changed({ subject: seq(hex("3100"), rdn("550403", "root")) })],
        [
          "a name in pieces",
          changed({ subject: seq(tlv(0x31, seq(oid("550403"), inPieces(0x0c, Buffer.from("root"))))) }),
        ],
        ["a key in pieces", changed({ key: seq(keyAlgorithm, inPieces(0x03, contentsOf(keyBits))) })],
        ["a UTCTime", longForm(changed({ validity: seq(...["200101000000Z", "491231235959Z"].map(utcTime)) }))],
        ["version 1 with extensions", changed({ version: none })],
        ["version 2 with extensions", changed({ version: hex("a003020101") })],
        ["version 4", changed({ version: hex("a003020103") })],
        ["version 1", longForm(changed({ version: none, extensions: none }))],
        ["version 1, spelled out", longForm(changed({ version: hex("a003020100"), extensions: none }))],
        ["version 1 with unique identifiers", changed({ version: none, extensions: hex("810100820100") })],
        ["version 3 without extensions", longForm(changed({ extensions: none })), "INVALID_PURPOSE", "INVALID_CA"],
        [
          "version 128 without extensions",
          changed({ version: hex("a00402020080"), extensions: none }),
          "INVALID_PURPOSE",
          "INVALID_CA",
        ],
        ["parameters: TRUE", changed({ algorithm: seq(contentsOf(algorithms.ec), hex("010101")) })],
        ["parameters: a long form", changed({ algorithm: seq(contentsOf(algorithms.ec), hex("308103020101")) })],
        ["parameters: EXTERNAL", changed({ algorithm: seq(contentsOf(algorithms.ec), hex("0800")) })],
        ["an extension that is not critical", extended(unknown("010100"))],
        ["an extension that is", extended(unknown("010101")), "INVALID_PURPOSE", "UNSPECIFIED"],
        ["name constraints", extended(permitOnlyExampleCom), "UNSPECIFIED", "UNSPECIFIED"],
      ])("hold: %s", async (_, tbs, refused = "INVALID_PURPOSE", trusted = "authorized") => {
        expect(await outcomes(tbs)).toEqual(all(refused, trusted));
      });

      it("hold if it has no valid validity, with the codes for out of date unlike in Node.js", async () => {
        expect([
          await outcomes(valid("20XX0101000000Z", "21200101000000Z")),
          await outcomes(valid("20200101000000Z", "21200101000000.5Z")),
        ]).toEqual([all("CERT_NOT_YET_VALID", "CERT_NOT_YET_VALID"), all("CERT_HAS_EXPIRED", "CERT_HAS_EXPIRED")]);
      });

      it("hold if its issuer has a name that BoringSSL does not parse", async () => {
        const issuer = seq(tlv(0x31, seq(oid("550403"), hex("0c03efbfbf"))));
        expect(await outcomes(changed({ issuer }))).toEqual(all("INVALID_PURPOSE", "authorized"));
      });

      it("do not get it sent to peers, unlike in Node.js", async () => {
        const entry = signed(longForm(fieldsOf(intermediate)[0]), caKey);
        const ca = armor("TRUSTED CERTIFICATE", Buffer.concat([entry, trustOnly(anyPurpose)])) + root;
        await using one = await serve(leaf, { ca });
        await using several = await serve(leaf, { ca, key: [key, serverTls.key], cert: [leaf, serverTls.single] });
        const ciphers = "ECDHE-ECDSA-AES128-GCM-SHA256";
        expect([
          await connect(one.port, { ca: root }),
          await connect(several.port, { ca: root, ciphers, maxVersion: "TLSv1.2" }),
        ]).toEqual(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]);
      });

      it("do not get it in the way if they name no use", async () => {
        const entry = signed(longForm(fieldsOf(intermediate)[0]), caKey);
        const alias = seq(hex("0c0141"));
        expect(await verify(chain, armor("TRUSTED CERTIFICATE", Buffer.concat([entry, alias])) + root)).toBe(
          "authorized",
        );
      });

      it("hold for the name it has", async () => {
        const named = (value: string) => seq(rdn("550403", "root"), tlv(0x31, seq(oid("55040a"), hex(value))));
        const subject = named("2803040141");
        const entry = signed(longForm(changed({ issuer: subject, subject })), caKey);
        expect(
          await verify(leaf + mint("intermediate", subject, ca) + mint(subject, "other root", ca), [
            armor("TRUSTED CERTIFICATE", Buffer.concat([entry, reject(serverAuth)])),
            otherRoot,
          ]),
        ).toBe("INVALID_PURPOSE");
      });
    });

    it("are read after a name that only BoringSSL parses, unlike in Node.js", async () => {
      const name = seq(tlv(0x31, seq(oid("550403"), hex("020101"))));
      expect(await verify(chain, root + mint(name, name, ca) + withSettings(intermediate, reject(serverAuth)))).toBe(
        "INVALID_PURPOSE",
      );
    });

    it("are those of the first copy", async () => {
      const rejected = withSettings(root, reject(serverAuth));
      const added = (ca: string, added: string) => {
        const secureContext = tls.createSecureContext({ ca });
        secureContext.context.addCACert(added);
        return verify(chain, [], { secureContext });
      };
      expect([
        await verify(chain, [root, rejected]),
        await verify(chain, [rejected, root]),
        await added(root, rejected),
        await added(rejected, root),
      ]).toEqual(["authorized", "INVALID_PURPOSE", "authorized", "INVALID_PURPOSE"]);
    });

    it("make an anchor of an intermediate, and come before extendedKeyUsage", async () => {
      expect([
        await verify(leaf, withSettings(intermediate, trustOnly(serverAuth))),
        await verify(chain, withSettings(copy("extendedKeyUsage=clientAuth"), trustOnly(serverAuth))),
        await verify(chain, withSettings(copy("CA:FALSE"), trustOnly(serverAuth))),
      ]).toEqual(["authorized", "authorized", "INVALID_CA"]);
    });

    it("are not read from what a peer sends", async () => {
      expect(
        await verify(leaf + withSettings(intermediate, trustOnly(serverAuth), "CERTIFICATE"), [unrelated[0]]),
      ).toBe("UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
    });

    it("that reject a CA hold when it is out of date, or may not sign", async () => {
      const expired = copy("a validity that ended", "usual", "intermediate");
      const mayNotSign = mint("intermediate", "root", [isCA, digitalSignature]);
      expect([
        await verify(chain, [root, withSettings(expired, reject(serverAuth))]),
        await verify(chain, [root, withSettings(mayNotSign, reject(serverAuth))]),
      ]).toEqual(["CERT_HAS_EXPIRED", "UNSPECIFIED"]);
    });

    it("that reject a leaf hold when its issuer is trusted, unlike in Node.js", async () => {
      expect(await verify(chain, [root, withSettings(leaf, reject(serverAuth))])).toBe("CERT_REJECTED");
    });

    it("that trust a leaf for another purpose do not reject it", async () => {
      const forClients = withSettings(leaf, trustOnly(clientAuth));
      expect([
        await verify(chain, [root, forClients]),
        await verify(chain, [forClients], { allowPartialTrustChain: true }),
      ]).toEqual(["authorized", "CERT_REJECTED"]);
    });

    it("do not extend the validity of an intermediate, unlike in Node.js", async () => {
      const expired = copy("a validity that ended", "usual", "intermediate");
      expect(await verify(leaf, withSettings(expired, trustOnly(serverAuth)))).toBe("CERT_HAS_EXPIRED");
    });

    it("apply to fetch, and to caFile", async () => {
      await using server = await serve(chain);
      using dir = tempDir("trusted-ca-file", {
        "trusted.pem": withSettings(root, trustOnly(serverAuth)),
        "rejected.pem": withSettings(root, reject(serverAuth)),
      });
      const get = (tls: Bun.TLSOptions) =>
        fetch(`https://127.0.0.1:${server.port}`, { tls, keepalive: false }).then(
          response => response.text(),
          error => error.code,
        );
      const outcomes: string[] = [];
      for (const name of ["trusted.pem", "rejected.pem"]) {
        const caFile = join(String(dir), name);
        outcomes.push(await get({ ca: Bun.file(caFile) }), await get({ caFile } as Bun.TLSOptions));
      }
      expect(outcomes).toEqual(["authorized", "authorized", "INVALID_PURPOSE", "INVALID_PURPOSE"]);
    });
  });

  describe("extensions", () => {
    const policy = (n: string) => seq(oid(`2a03${n}`));
    const policies = (...body: Buffer[]) => extension("551d20", seq(...body));
    const requirePolicy = extension("551d24", seq(hex("800100")), true);
    const rawNetscapeType = (value: string) => extension("6086480186f8420101", hex(value));
    const distributionPoint = seq(seq(tlv(0xa0, tlv(0xa0, tlv(0x86, Buffer.from("http://crl.test/"))))));

    it.each([
      ["CA:FALSE with a path length", [extension("551d13", seq(hex("020100")), true)], "authorized"],
      ["Netscape server gated cryptography", [eku(oid("6086480186f8420401"))], "authorized"],
      ["Microsoft server gated cryptography", [eku(oid("2b0601040182370a0303"))], "authorized"],
      ["a Netscape type for servers", [netscapeType("server")], "authorized"],
      ["a critical Netscape type", [netscapeType("server", true)], "authorized"],
      ["a Netscape type for clients", [netscapeType("client")], "INVALID_PURPOSE"],
      ["a Netscape type with unused bits set", [rawNetscapeType("03020641")], "authorized"],
      ["a Netscape type with that for servers among them", [rawNetscapeType("030207c0")], "INVALID_PURPOSE"],
      ["a Netscape type in a long form", [rawNetscapeType("0381020640")], "authorized"],
      ["a byte after a Netscape type", [rawNetscapeType("0302064000")], "authorized"],
      ["a malformed Netscape type", [rawNetscapeType("0500")], "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
      ["critical CRL distribution points", [extension("551d1f", distributionPoint, true)], "authorized"],
      ["a critical OCSP noCheck", [extension("2b0601050507300105", hex("0500"), true)], "authorized"],
      ["no policy in certificatePolicies", [policies()], "authorized"],
      ["the same policy twice", [policies(policy("01"), policy("01"))], "authorized"],
      ["malformed certificatePolicies", [extension("551d20", hex("0500"))], "authorized"],
      ["an empty keyUsage", [extension("551d0f", hex("030100"))], "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
    ])("a leaf with %s", async (_, extensions, expected) => {
      const leaf = mint("leaf", "intermediate", [...extensions, localhost], { subjectKey: leafKey });
      expect(await verify(leaf + intermediate, [root])).toBe(expected);
    });

    it.each([
      ["version 1", [], { v1: true }, "authorized", "INVALID_PURPOSE"],
      ["keyCertSign", [keyCertSign], {}, "authorized", "INVALID_CA"],
      ["a Netscape type for CAs", [netscapeType("sslCA")], {}, "authorized", "INVALID_CA"],
    ])("a CA without basicConstraints but %s", async (_, extensions, options, asRoot, asIntermediate) => {
      const [top, middle] = ["root", "intermediate"].map(name => mint(name, "root", extensions, options));
      expect({
        asRoot: await verify(chain, [top]),
        asIntermediate: await verify(leaf + middle, [root]),
        ca: [top, middle].map(pem => new X509Certificate(pem).ca),
      }).toEqual({ asRoot, asIntermediate, ca: [false, false] });
    });

    it("the policy constraints of a root do not apply", async () => {
      expect(await verify(chain, [mint("root", "root", [...ca, requirePolicy])])).toBe("authorized");
    });

    // RFC 5280, section 4.2.1.11. OpenSSL counts the extension as handled, and does not look at it.
    it("the policy constraints of an intermediate apply, unlike in Node.js", async () => {
      const constrained = mint("intermediate", "root", [...ca, policies(policy("01")), requirePolicy]);
      const under = (n: string) =>
        mint("leaf", "intermediate", [policies(policy(n)), localhost], { subjectKey: leafKey }) + constrained;
      expect([await verify(under("01"), [root]), await verify(under("02"), [root])]).toEqual([
        "authorized",
        "UNSPECIFIED",
      ]);
    });

    describe("the keyUsage of a leaf", () => {
      const rsaKey = { privateKey: createPrivateKey(serverTls.key), publicKey: createPublicKey(serverTls.key) };
      const usages = {
        digitalSignature: "0780",
        nonRepudiation: "0640",
        keyEncipherment: "0520",
        keyAgreement: "0308",
        keyCertSign: "0204",
      };
      const keyUsage = (usage: keyof typeof usages) => extension("551d0f", tlv(0x03, hex(usages[usage])), true);
      const identity = (subjectKey: KeyPair, usage: keyof typeof usages) => ({
        key: subjectKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
        cert: mint("leaf", "intermediate", [keyUsage(usage), localhost], { subjectKey }) + intermediate,
      });
      const tls12 = { maxVersion: "TLSv1.2" } as const;
      const forPurposes = [
        ["digitalSignature", "authorized", "authorized"],
        ["keyEncipherment", "authorized", "INVALID_PURPOSE"],
        ["keyAgreement", "authorized", "authorized"],
        ["nonRepudiation", "INVALID_PURPOSE", "INVALID_PURPOSE"],
        ["keyCertSign", "INVALID_PURPOSE", "INVALID_PURPOSE"],
      ] as const;

      // BoringSSL matches it to the key exchange. OpenSSL declined: https://github.com/openssl/openssl/issues/12721
      it.each(forPurposes)("%s has to suit the purpose, not the key exchange", async (usage, asServer, asClient) => {
        const [rsa, ec] = [rsaKey, leafKey].map(subjectKey => identity(subjectKey, usage));
        await using server = await serve(rsa.cert, rsa);
        expect({
          asServer: [
            await connect(server.port, { ca: root }),
            await connect(server.port, { ca: root, ...tls12, ciphers: "ECDHE-RSA-AES128-GCM-SHA256" }),
            await connect(server.port, { ca: root, ...tls12, ciphers: "AES128-GCM-SHA256" }),
            await verify(ec.cert, root),
          ],
          asClient: [
            await verifyClient(rsa.cert, root, rsa),
            await verifyClient(rsa.cert, root, { ...rsa, ...tls12 }),
            await verifyClient(ec.cert, root),
            await verifyClient(ec.cert, root, tls12),
          ],
          toAnyone: [
            await connect(server.port, { rejectUnauthorized: false }),
            await connect(server.port, { rejectUnauthorized: false, ...tls12 }),
          ],
        }).toEqual({
          asServer: Array(4).fill(asServer),
          asClient: Array(4).fill(asClient),
          toAnyone: ["authorized", "authorized"],
        });
      });

      it("keyEncipherment is enough for a self-signed certificate, as IIS makes them", async () => {
        const extensions = [extension("551d0f", hex("03020430")), eku(serverAuth), localhost];
        const cert = mint("self", "self", extensions, { subjectKey: rsaKey, signer: rsaKey });
        await using server = await serve(cert, { key: serverTls.key });
        const get = (tls: Bun.TLSOptions) =>
          fetch(`https://127.0.0.1:${server.port}`, { tls, keepalive: false }).then(
            response => response.text(),
            error => error.code ?? error.cause.code,
          );
        expect([
          await connect(server.port, { ca: cert }),
          await connect(server.port, { ca: cert, ...tls12 }),
          await connect(server.port, { ca: root }),
          await get({ ca: cert }),
          await get({ rejectUnauthorized: false }),
        ]).toEqual(["authorized", "authorized", "DEPTH_ZERO_SELF_SIGNED_CERT", "authorized", "authorized"]);
      });

      it("with HTTP/3", async () => {
        const certs = forPurposes.map(([usage]) => identity(leafKey, usage).cert);
        using dir = tempDir("key-usage", { "root.pem": root, "plan.json": JSON.stringify({ key, certs }) });
        const script = `
          const { key, certs } = await Bun.file("plan.json").json();
          for (const cert of certs) {
            const fetch = () => new Response("authorized");
            using server = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { key, cert }, http3: true, fetch });
            console.log(await globalThis.fetch(server.url, { protocol: "http3" }).then(res => res.text(), error => error.code));
          }
          process.exit(0);
        `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", script],
          cwd: String(dir),
          env: { ...bunEnv, NODE_EXTRA_CA_CERTS: "root.pem" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ outcomes: stdout.trim().split(/\r?\n/), stderr, exitCode }).toEqual({
          outcomes: forPurposes.map(([, asServer]) => (asServer === "authorized" ? asServer : "HTTP3HandshakeFailed")),
          stderr: "",
          exitCode: 0,
        });
      });

      describe("has to allow signatures for the ECDSA cipher suites of TLS 1.2", () => {
        it("or a server does not offer them", async () => {
          const [ec, rsa] = [leafKey, rsaKey].map(subjectKey => identity(subjectKey, "keyAgreement"));
          await using alone = tls.createServer(ec);
          await once(alone.listen(0, "127.0.0.1"), "listening");
          const refused = once(alone, "tlsClientError");
          await connect((alone.address() as AddressInfo).port, { ca: root, ...tls12 });
          await using both = await serve(ec.cert, { key: [ec.key, rsa.key], cert: [ec.cert, rsa.cert] });
          expect([(await refused)[0].code, await connect(both.port, { ca: root, ...tls12 })]).toEqual([
            "ERR_SSL_NO_SHARED_CIPHER",
            "authorized",
          ]);
        });

        // Ed25519 shares them, and a server does not look at the key usage of such a certificate.
        it("or a client gives up, even if it would accept anyone", async () => {
          const ed25519 = identity(ed25519Key, "keyAgreement");
          await using server = await serve(ed25519.cert, ed25519);
          expect([
            await connect(server.port, { ca: root, ...tls12 }),
            await connect(server.port, { rejectUnauthorized: false, ...tls12 }),
            await connect(server.port, { ca: root }),
          ]).toEqual(["ERR_SSL_ECC_CERT_NOT_FOR_SIGNING", "ERR_SSL_ECC_CERT_NOT_FOR_SIGNING", "authorized"]);
        });
      });
    });
  });

  describe("an entry of `ca` that is of no use", () => {
    const der = new X509Certificate(root).raw;
    const missing = "UNABLE_TO_GET_ISSUER_CERT_LOCALLY";

    it.each([
      ["text", "not a certificate\n", "authorized"],
      ["a private key", key, "authorized"],
      ["a certificate with a malformed validity", mint("other", "other", ca, { to: "21XX" }), "authorized"],
      ["not DER", armor("CERTIFICATE", Buffer.from("not a certificate")), missing],
      ["not base64", "-----BEGIN CERTIFICATE-----\n!\n-----END CERTIFICATE-----\n", missing],
      ["cut short", armor("CERTIFICATE", der.subarray(0, 100)), missing],
      ["malformed trust settings", withSettings(unrelated[0], hex("0500")), missing],
      [
        "a malformed certificate with trust settings",
        armor("TRUSTED CERTIFICATE", Buffer.concat([seq(contentsOf(der), hex("0500")), trustOnly(serverAuth)])),
        missing,
      ],
    ])("%s", async (_, entry, whenFirstInOneString) => {
      await using server = await serve(chain);
      const added = (...entries: string[]) => {
        const secureContext = tls.createSecureContext();
        for (const entry of entries) secureContext.context.addCACert(entry);
        return connect(server.port, { secureContext });
      };
      expect({
        alone: [await connect(server.port, { ca: entry }), await added(entry)],
        first: [await connect(server.port, { ca: [entry, root] }), await added(entry, root)],
        last: [await connect(server.port, { ca: [root, entry] }), await added(root, entry)],
        firstInOneString: [await connect(server.port, { ca: entry + root }), await added(entry + root)],
        lastInOneString: [await connect(server.port, { ca: root + entry }), await added(root + entry)],
      }).toEqual({
        alone: [missing, missing],
        first: ["authorized", "authorized"],
        last: ["authorized", "authorized"],
        firstInOneString: [whenFirstInOneString, whenFirstInOneString],
        lastInOneString: ["authorized", "authorized"],
      });
    });

    it("is an error for the APIs of Bun, unless it is a PEM document of something else", () => {
      const listen = (ca: string | string[]) => {
        try {
          Bun.listen({ hostname: "127.0.0.1", port: 0, tls: { ca }, socket: { data() {} } }).stop(true);
          return "listening";
        } catch (error: any) {
          return error.message;
        }
      };
      const cut = armor("CERTIFICATE", der.subarray(0, 100));
      const broken = mint("other", "other", ca, { to: "21XX" });
      expect({
        useless: ["text", "", cut, root.slice(0, 200), broken, key.replace("\n", "\n!")].map(entry => [
          listen([entry, root]),
          listen([root, entry]),
        ]),
        key: [listen(key), listen([key, root])],
        afterACertificate: [listen(root + cut), listen(root + broken)],
      }).toEqual({
        useless: Array(6).fill(["Invalid CA", "Invalid CA"]),
        key: ["listening", "listening"],
        afterACertificate: ["listening", "listening"],
      });
    });
  });

  it("caFile is read whole or not at all", async () => {
    await using server = await serve(chain);
    const files = {
      padded: withSettings(root, hex("0a"), "CERTIFICATE"),
      withCrl: crlOf("root") + crlOf("intermediate") + root,
      byteOrderMark: byteOrderMark + root + unrelated[0],
      rejected: byteOrderMark + withSettings(intermediate, reject(serverAuth)) + root,
      encrypted: encrypted(root, ""),
      empty: "",
      key,
      crl: crlOf("root"),
      cut: root + armor("CERTIFICATE", derOf(root).subarray(0, 100)),
      cutCrl: root + armor("X509 CRL", derOf(root).subarray(0, 100)),
      notBase64: root + "-----BEGIN CERTIFICATE-----\n!\n-----END CERTIFICATE-----\n",
      withHeader: root + root.replace("\n", "\nComment: text\n\n"),
      malformedValidity: root + mint("other", "other", ca, { to: "21XX" }),
    };
    using dir = tempDir("ca-file", files);
    const outcomes: Record<string, unknown> = {};
    for (const name of Object.keys(files)) {
      const { promise, resolve } = Promise.withResolvers();
      try {
        using socket = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          tls: {
            caFile: join(String(dir), name),
            crl: name === "withCrl" ? crlOf("other") : undefined,
          } as Bun.TLSOptions,
          socket: { data() {}, handshake: socket => resolve(socket.authorized), close: () => resolve("closed") },
        });
        outcomes[name] = await promise;
      } catch (error: any) {
        outcomes[name] = error.message;
      }
    }
    expect(outcomes).toEqual({
      padded: true,
      withCrl: true,
      byteOrderMark: true,
      rejected: false,
      encrypted: true,
      empty: "Failed to load CA file",
      key: "Failed to load CA file",
      crl: "Failed to load CA file",
      cut: "Invalid CA file",
      cutCrl: "Invalid CA file",
      notBase64: "Invalid CA file",
      withHeader: "Invalid CA file",
      malformedValidity: "Invalid CA file",
    });
  });

  it("addCACert() takes a string or a view of bytes, and ignores the rest", async () => {
    await using server = await serve(chain);
    const added = (value: unknown) => {
      const secureContext = tls.createSecureContext({ ca: [] });
      secureContext.context.addCACert(value);
      return connect(server.port, { secureContext });
    };
    const bytes = new TextEncoder().encode(root + unrelated[0] + root);
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
    shared.set(bytes);
    expect({
      taken: [
        await added(Buffer.from(root)),
        await added(bytes),
        await added(shared),
        await added(new DataView(bytes.buffer)),
        await added(new Uint16Array(bytes.buffer, 0, bytes.length >> 1)),
      ],
      outsideTheView: await added(bytes.subarray(root.length, -root.length)),
      ignored: [
        await added(bytes.buffer),
        await added([root]),
        await added(new String(root)),
        await added({ toString: () => root }),
        await added(undefined),
        await added(null),
        await added(1),
      ],
    }).toEqual({
      taken: Array(5).fill("authorized"),
      outsideTheView: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      ignored: Array(7).fill("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"),
    });
  });

  it("`key`, `cert`, `ca` and `crl` take a DataView", async () => {
    const view = (pem: string): any => new DataView(new TextEncoder().encode(root + pem).buffer, root.length);
    await using server = await serve(view(chain), { key: view(key) });
    expect([
      await connect(server.port, { ca: view(root) }),
      await connect(server.port, { ca: [view(unrelated[0])] }),
      await connect(server.port, { ca: root, crl: view(crlOf("root") + crlOf("intermediate", leaf)) }),
    ]).toEqual(["authorized", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_REVOKED"]);
  });

  it.each([
    ["the label of old", (pem: string) => pem.replace(/(?<=BEGIN|END) CERTIFICATE/g, " X509 CERTIFICATE"), true],
    ["an empty passphrase", (pem: string) => encrypted(pem, ""), true],
    ["the same after a byte order mark", (pem: string) => key + byteOrderMark + encrypted(pem, ""), true],
    ["a byte order mark at the start", (pem: string) => byteOrderMark + pem, true],
    ["a byte order mark after a certificate", (pem: string) => unrelated[0] + byteOrderMark + pem, true],
    ["a byte order mark after a private key", (pem: string) => key + byteOrderMark + pem, true],
    ["a byte order mark after a comment", (pem: string) => "# comment\n" + byteOrderMark + pem, false],
    ["lines of 253 characters", (pem: string) => pem.replace(/(?<!-)\n(?!-)/g, "").replace(/.{253}/g, "$&\n"), true],
    ["lines of 254 characters", (pem: string) => pem.replace(/(?<!-)\n(?!-)/g, "").replace(/.{254}/g, "$&\n"), true],
    ["no last line, ahead of another", (pem: string) => pem.replace(/-----END.*\n/, "") + pem, true],
    ["two such ahead of it", (pem: string) => unrelated[0].replace(/-----END.*\n/, "") + unrelated[1] + pem, true],
    ["253 characters ahead of it", (pem: string) => Buffer.alloc(253, "#") + pem, false],
    ["254 characters ahead of it", (pem: string) => Buffer.alloc(254, "#") + pem, true],
    ["a NUL in a comment", (pem: string) => "# comment\0\n" + pem, true],
    ["a NUL after a certificate", (pem: string) => unrelated[0] + "\0\n" + pem, true],
    ["a NUL at the end of each line", (pem: string) => pem.replaceAll("\n", "\0\n"), true],
    ["a NUL at the end", (pem: string) => pem + "\0", true],
    ["a NUL at the start of the first line", (pem: string) => "\0" + pem, false],
  ])("a block with %s", async (_, change, isRead) => {
    await using server = await serve(chain);
    const secureContext = tls.createSecureContext({ ca: [] });
    secureContext.context.addCACert(change(root));
    const withCrl = async (crl: string) =>
      connect(server.port, { ca: root, crl: [crlOf("root"), crlOf("other") + crl] });
    expect({
      string: await connect(server.port, { ca: change(root) }),
      buffer: await connect(server.port, { ca: Buffer.from(change(root)) }),
      addCACert: await connect(server.port, { secureContext }),
      rejected: await connect(server.port, { ca: [root, change(withSettings(intermediate, reject(serverAuth)))] }),
      crl: await withCrl(change(crlOf("intermediate", leaf))),
    }).toEqual(
      isRead
        ? {
            string: "authorized",
            buffer: "authorized",
            addCACert: "authorized",
            rejected: "INVALID_PURPOSE",
            crl: "CERT_REVOKED",
          }
        : {
            string: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
            buffer: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
            addCACert: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
            rejected: "authorized",
            crl: "UNABLE_TO_GET_CRL",
          },
    );
  });

  it.each<[string, (fields: Buffer[]) => Buffer]>([
    ["a long form", fields => longForm(seq(...fields))],
    ["an indefinite length", fields => indefinite(seq(...fields))],
    ["a long form of the algorithm", ([tbs, algorithm, signature]) => seq(tbs, longForm(algorithm), signature)],
    ["one of its OID", ([tbs, algorithm, signature]) => seq(tbs, seq(longForm(contentsOf(algorithm))), signature)],
    ["one of the signature", ([tbs, algorithm, signature]) => seq(tbs, algorithm, longForm(signature))],
    ["a signature in pieces", ([tbs, algorithm, signature]) => seq(tbs, algorithm, tlv(0x23, signature))],
  ])("what is not signed is not held to DER: %s", async (_, encode) => {
    await using server = await serve(chain);
    await using leafOnly = await serve(leaf);
    const plain = (pem: string) => armor("CERTIFICATE", encode(fieldsOf(pem)));
    const rejected = armor("TRUSTED CERTIFICATE", Buffer.concat([encode(fieldsOf(intermediate)), reject(serverAuth)]));
    const crl = [crlOf("root") + armor("X509 CRL", encode(fieldsOf(crlOf("intermediate", leaf))))];
    expect({
      root: await connect(server.port, { ca: plain(root) }),
      intermediate: await connect(leafOnly.port, { ca: [plain(intermediate), root] }),
      rejected: await connect(server.port, { ca: rejected + root }),
      crl: await connect(server.port, { ca: root, crl }),
    }).toEqual({ root: "authorized", intermediate: "authorized", rejected: "INVALID_PURPOSE", crl: "CERT_REVOKED" });
  });

  it("nor are the parameters of the algorithm, or the bits that a signature leaves unused", async () => {
    const rsaKey = { privateKey: createPrivateKey(serverTls.key), publicKey: createPublicKey(serverTls.key) };
    const [tbs, , signature] = fieldsOf(mint("intermediate", "root", ca, { signer: rsaKey }));
    const rsaRoot = mint("root", "root", ca, { signer: rsaKey, subjectKey: rsaKey });
    const rejected = (signature: string) => {
      const der = seq(...fieldsOf(intermediate).slice(0, 2), hex(signature));
      return armor("TRUSTED CERTIFICATE", Buffer.concat([der, reject(serverAuth)])) + root;
    };
    expect([
      await verify(leaf, [
        armor("CERTIFICATE", seq(tbs, seq(oid("2a864886f70d01010b"), hex("058100")), signature)),
        rsaRoot,
      ]),
      await verify(chain, rejected("030207ff")),
      await verify(chain, rejected("030107")),
    ]).toEqual(["authorized", "CERT_SIGNATURE_FAILURE", "CERT_SIGNATURE_FAILURE"]);
  });

  it.each(["010101", "308103020101", "30800201010000", "0800", "0c01ff"])(
    "the parameters %s keep a signature from being valid, and nothing else",
    async parameters => {
      const changed = (pem: string, settings = hex("")) => {
        const [tbs, algorithm, signature] = fieldsOf(pem);
        const der = seq(tbs, seq(contentsOf(algorithm), hex(parameters)), signature);
        return armor("TRUSTED CERTIFICATE", Buffer.concat([der, settings]));
      };
      expect([
        await verify(chain, changed(root)),
        await verify(leaf, changed(intermediate) + root),
        await verify(chain, changed(intermediate, reject(serverAuth)) + root),
      ]).toEqual(["authorized", "CERT_SIGNATURE_FAILURE", "CERT_SIGNATURE_FAILURE"]);
    },
  );

  it("a NUL does not end `cert` or `key` either", async () => {
    await using server = await serve(leaf + "\0\n" + intermediate, { key: "\0\n" + key });
    expect(await connect(server.port, { ca: root })).toBe("authorized");
  });

  it("nor does a byte order mark hide a block of them", async () => {
    await using server = await serve(byteOrderMark + leaf + byteOrderMark + intermediate, { key: byteOrderMark + key });
    expect(await connect(server.port, { ca: root })).toBe("authorized");
  });

  it("a NUL does not end a Bun.file()", async () => {
    await using server = await serve(chain);
    using dir = tempDir("ca-with-nul", { "ca.pem": unrelated[0] + "\0\n" + root });
    const tls = { ca: Bun.file(join(String(dir), "ca.pem")) };
    expect(await fetch(`https://127.0.0.1:${server.port}`, { tls }).then(response => response.text())).toBe(
      "authorized",
    );
  });

  it("all the CRLs in a string are read", async () => {
    await using server = await serve(chain);
    const withCrl = (crl: string) => {
      try {
        return connect(server.port, { secureContext: tls.createSecureContext({ ca: root, crl }) });
      } catch (error: any) {
        return error.code;
      }
    };
    const valid = crlOf("root") + crlOf("intermediate");
    expect({
      valid: await withCrl(valid),
      revoked: await withCrl(crlOf("root") + root + crlOf("intermediate", leaf)),
      none: await withCrl(root),
      notDer: await withCrl(valid + armor("X509 CRL", hex("0500"))),
      notBase64: await withCrl(valid + "-----BEGIN X509 CRL-----\n!\n-----END X509 CRL-----\n"),
      withHeader: await withCrl(valid + crlOf("other").replace("\n", "\nComment: text\n\n")),
    }).toEqual({
      valid: "authorized",
      revoked: "CERT_REVOKED",
      none: "ERR_CRYPTO_OPERATION_FAILED",
      notDer: "ERR_CRYPTO_OPERATION_FAILED",
      notBase64: "ERR_CRYPTO_OPERATION_FAILED",
      withHeader: "ERR_CRYPTO_OPERATION_FAILED",
    });
  });

  it("a CRL that BoringSSL does not parse is an error, unlike in Node.js", () => {
    const tbs = seq(hex("020101"), algorithms.ec, dn("other"), time("20200101000000.5Z"));
    expect(() => tls.createSecureContext({ crl: crlOf("root") + armor("X509 CRL", signed(tbs, caKey)) })).toThrow(
      expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" }),
    );
  });

  describe("setDefaultCACertificates()", () => {
    /** The code of the error, or else whether it has got to the root after `entry`. */
    function outcomes(entries: Record<string, string>) {
      const before = tls.getCACertificates("default");
      const outcome = (entry: string) => {
        try {
          tls.setDefaultCACertificates([entry + root]);
          return tls.getCACertificates("default").includes(root);
        } catch (error: any) {
          return error.code;
        }
      };
      try {
        return Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, outcome(entry)]));
      } finally {
        tls.setDefaultCACertificates(before);
      }
    }

    // BoringSSL refuses all of these for their validity, whatever else is the matter with them.
    const fields = {
      version: hex("a003020102"),
      serial: hex("020101"),
      algorithm: algorithms.ec,
      issuer: dn("other"),
      validity: seq(time("20200101000000Z"), time("21XX0101000000Z")),
      subject: dn("other"),
      key: caKey.publicKey.export({ type: "spki", format: "der" }),
      uniqueIds: hex(""),
      extensions: tlv(0xa3, seq(...ca)),
    };
    const tbs = (changes: Partial<typeof fields> = {}) => seq(...Object.values({ ...fields, ...changes }));
    const signature = hex("03020001");
    const changed = (changes: Partial<typeof fields>) => seq(tbs(changes), algorithms.ec, signature);
    const named = (value: Buffer) => changed({ subject: seq(tlv(0x31, seq(oid("550403"), value))) });
    const withParameters = (parameters: string) => changed({ algorithm: seq(oid("2a0304"), hex(parameters)) });
    const withExtension = (...body: Buffer[]) => changed({ extensions: tlv(0xa3, seq(seq(oid("2a0304"), ...body))) });
    const until = (tag: number, text: string) =>
      changed({ validity: seq(time("20XX0101000000Z"), tlv(tag, Buffer.from(text))) });
    const nested = (depth: number): Buffer => (depth ? tlv(0x24, nested(depth - 1)) : hex("040101"));
    const each = <K extends keyof typeof fields>(label: string, change: (field: Buffer) => Buffer, ...names: K[]) =>
      Object.fromEntries(names.map(name => [`${name}: ${label}`, changed({ [name]: change(fields[name]) })]));
    const nameTypes = [3, 7, 8, 9, 11, 12, 13, 14, 15, 18, 19, 20, 22, 28, 29, 30];
    const namesOfType = (types: number[]) =>
      Object.fromEntries(types.map(type => [`a name of type ${type}`, named(tlv(type, hex("00000041")))]));
    const constructed = ["version", "algorithm", "issuer", "validity", "subject", "key", "extensions"] as const;
    const required = ["serial", "algorithm", "issuer", "validity", "subject", "key"] as const;
    const primitive = (field: Buffer) => Buffer.concat([Buffer.from([field[0] & ~0x20]), field.subarray(1)]);
    const armored = (ders: Record<string, Buffer>) =>
      Object.fromEntries(Object.entries(ders).map(([name, der]) => [name, armor("CERTIFICATE", der)]));

    it("goes on after what OpenSSL reads as a certificate", () => {
      const read = {
        "nothing else": changed({}),
        "bytes after it": Buffer.concat([changed({}), hex("0a")]),
        "long form": longForm(changed({})),
        "indefinite": indefinite(changed({})),
        "tbsCertificate: indefinite": seq(indefinite(tbs()), algorithms.ec, signature),
        ...each("long form", longForm, "serial", ...constructed),
        ...each("indefinite", indefinite, ...constructed),
        ...each("left out", () => hex(""), "version", "extensions"),
        ...each("not tagged as constructed", primitive, "issuer", "subject"),
        "version 4": changed({ version: hex("a003020103") }),
        "a negative serial number": changed({ serial: hex("0201ff") }),
        "an empty name": changed({ subject: seq() }),
        "an empty RDN": changed({ subject: seq(hex("3100")) }),
        ...namesOfType(nameTypes),
        "a name that is a SEQUENCE": named(hex("3002ffff")),
        "a name in pieces": named(hex("2c060c01c30c01a9")),
        "a noncharacter in UTF-8": named(hex("0c03efbfbe")),
        "the code points next to the surrogates": named(hex("1e04d7ffe000")),
        "the last code point": named(hex("1c040010ffff")),
        "Latin-1": named(hex("1401e9")),
        "a UTCTime of 13 bytes": until(0x17, "XXXXXXXXXXXXX"),
        "a GeneralizedTime with a fraction": until(0x18, "21200101000000.5Z"),
        "both unique identifiers": changed({ uniqueIds: hex("8101008202" + "0780") }),
        "only the second unique identifier": changed({ uniqueIds: hex("820100") }),
        "an empty list of extensions": changed({ extensions: hex("a3023000") }),
        "critical FALSE": withExtension(hex("010100"), hex("0400")),
        "a value in pieces of another type": withExtension(hex("2403020101")),
        "a value in pieces 6 deep": withExtension(nested(6)),
        "a value in pieces, indefinite": withExtension(indefinite(nested(1))),
        "an unknown key": changed({ key: seq(seq(oid("2a0304")), signature) }),
        "parameters: NULL": withParameters("0500"),
        "parameters: ENUMERATED": withParameters("0a0101"),
        "parameters: a SET": withParameters("3102ffff"),
        "parameters: context-specific": withParameters("8101ff"),
        "parameters: context-specific, with the number of INTEGER": withParameters("8200"),
        "parameters: context-specific and constructed": withParameters("a102ffff"),
        "parameters: last of an indefinite length": changed({ algorithm: indefinite(seq(oid("2a0304"), seq())) }),
        "parameters: indefinite within indefinite": withParameters("3080a080050000000000"),
        "parameters: tag 0": withParameters("000141"),
        "parameters: the highest tag": withParameters("9f87ffffff7f00"),
        "parameters: a length of no bytes, in 127": withParameters("04ff" + "00".repeat(127)),
        "parameters: a length in 5 bytes": withParameters("0485000000000141"),
        "a low tag in the long form": changed({ serial: hex("1f020101") }),
        "the same, padded": changed({ serial: hex("1f80020101") }),
        "a piece with tag 0": withExtension(hex("2403000141")),
        "7 unused bits": seq(tbs(), algorithms.ec, hex("030207ff")),
      };
      expect(outcomes(armored(read))).toEqual(Object.fromEntries(Object.keys(read).map(name => [name, true])));
    });

    it("throws for what it does not", () => {
      const otherTypes = Array.from({ length: 30 }, (_, i) => i + 1).filter(type => !nameTypes.includes(type));
      const refused = {
        "cut short": changed({}).subarray(0, 100),
        "no end of contents": indefinite(changed({})).subarray(0, -2),
        "half an end of contents": indefinite(changed({})).subarray(0, -1),
        "something else for an end of contents": Buffer.concat([indefinite(changed({})).subarray(0, -2), hex("0001")]),
        "not tagged as constructed": primitive(changed({})),
        "no signature": seq(tbs(), algorithms.ec),
        "no signature algorithm": seq(tbs(), signature),
        "an empty signature algorithm": seq(tbs(), seq(), signature),
        "a signature algorithm without an OID": seq(tbs(), seq(hex("0500")), signature),
        "a field after the signature": seq(tbs(), algorithms.ec, signature, hex("0500")),
        "a signature of another type": seq(tbs(), algorithms.ec, hex("040100")),
        "an empty BIT STRING": seq(tbs(), algorithms.ec, hex("0300")),
        "8 unused bits": seq(tbs(), algorithms.ec, hex("030208ff")),
        ...each("left out", () => hex(""), ...required),
        ...each("NULL", () => hex("0500"), ...required, "extensions"),
        ...each("twice", field => Buffer.concat([field, field]), "version", ...required, "extensions"),
        ...each("empty", field => tlv(field[0]), "version", "serial", "algorithm", "validity", "key", "extensions"),
        ...each("with one more", field => tlv(field[0], contentsOf(field), hex("0500"), hex("0500")), ...constructed),
        ...each("with an end of contents", field => tlv(field[0], contentsOf(field), hex("0000")), ...constructed),
        ...each("not tagged as constructed", primitive, "version", "algorithm", "validity", "key", "extensions"),
        "a version that is no INTEGER": changed({ version: hex("a0020500") }),
        "a padded serial number": changed({ serial: hex("02020001") }),
        "a serial number in pieces": changed({ serial: hex("2203020101") }),
        "a padded OID": changed({ algorithm: seq(oid("8001")) }),
        "an OID in pieces": changed({ algorithm: seq(hex("260306012a")) }),
        "an RDN that is no SET": changed({ subject: seq(seq(seq(oid("550403"), hex("0c0141")))) }),
        "an attribute without a type": changed({ subject: seq(tlv(0x31, seq(hex("0c0141"), hex("0c0141")))) }),
        "an attribute without a value": named(hex("")),
        "an attribute not tagged as constructed": changed({
          subject: seq(tlv(0x31, tlv(0x10, oid("550403"), hex("0c0141")))),
        }),
        ...namesOfType(otherTypes),
        ...Object.fromEntries(
          ["0101ff", "020101", "0500", "0a0101", "170d" + "58".padEnd(26, "58"), "180f" + "58".padEnd(30, "58")].map(
            value => [`a name of ${value}`, named(hex(value))],
          ),
        ),
        "a name that is a SET": named(hex("3100")),
        "a context-specific name": named(hex("8c0141")),
        "a name with a tag of two bytes": named(hex("1f2c0141")),
        "invalid UTF-8": named(hex("0c02ff41")),
        "half a BMP character": named(hex("1e03004100")),
        "half a universal character": named(hex("1c020041")),
        "the first surrogate": named(hex("1e02d800")),
        "the last surrogate": named(hex("1e040041dfff")),
        "past the last code point": named(hex("1c0400110000")),
        "a UTCTime of 12 bytes": until(0x17, "XXXXXXXXXXXX"),
        "a GeneralizedTime of 14 bytes": until(0x18, "XXXXXXXXXXXXXX"),
        "a time of another type": until(0x0c, "XXXXXXXXXXXXXXX"),
        "one time": changed({ validity: seq(time("21XX0101000000Z")) }),
        "an empty first unique identifier": changed({ uniqueIds: hex("8100") }),
        "an empty second unique identifier": changed({ uniqueIds: hex("8200") }),
        "unique identifiers out of order": changed({ uniqueIds: hex("820100810100") }),
        "extensions that are no SEQUENCE": changed({ extensions: hex("a3023100") }),
        "extensions with another tag": changed({ extensions: hex("a4023000") }),
        "an extension without a type": changed({ extensions: tlv(0xa3, seq(seq(hex("0400")))) }),
        "an extension without a value": withExtension(hex("0101ff")),
        "an empty BOOLEAN": withExtension(hex("0100"), hex("0400")),
        "a BOOLEAN of 2 bytes": withExtension(hex("0102ffff"), hex("0400")),
        "a BOOLEAN in pieces": withExtension(hex("21030101ff"), hex("0400")),
        "a value in pieces 7 deep": withExtension(nested(7)),
        "a value in pieces that are cut short": withExtension(hex("24020401")),
        "a key without bits": changed({ key: seq(algorithms.ec) }),
        "a key without an algorithm": changed({ key: seq(signature) }),
        "parameters: NULL with contents": withParameters("050100"),
        "parameters: NULL in pieces": withParameters("2500"),
        "parameters: a padded ENUMERATED": withParameters("0a020001"),
        "parameters: half a BMP character": withParameters("1e0141"),
        "parameters: half a universal character": withParameters("1c020041"),
        "parameters: a SEQUENCE not tagged as constructed": withParameters("1000"),
        "parameters: a SET not tagged as constructed": withParameters("1100"),
        "parameters: cut short": withParameters("8102ff"),
        "parameters: cut within the tag": withParameters("9f81"),
        "parameters: cut after the tag": withParameters("81"),
        "parameters: cut within the length": withParameters("818200"),
        "parameters: past the highest tag": withParameters("9f888080800000"),
        "parameters: a length of 2 ** 64 + 1": withParameters("048901000000000000000141"),
        "parameters: indefinite and not constructed": withParameters("80800000"),
        "a tag that is 2 ** 29 too high": changed({ serial: hex("1f82808080020101") }),
        "the same, for a SEQUENCE": changed({ key: Buffer.concat([hex("1f8280808010"), fields.key.subarray(1)]) }),
        "parameters: an end of contents too few": withParameters("3080a0800000"),
      };
      const thrown = Object.entries(outcomes(armored(refused))).map(([name, code]) => [name, typeof code]);
      expect(Object.fromEntries(thrown)).toEqual(
        Object.fromEntries(Object.keys(refused).map(name => [name, "string"])),
      );
    });

    it("throws for a block with a header", () => {
      const withHeader = (header: string) => unrelated[0].replace("\n", `\n${header}\n\n`);
      expect(
        outcomes({
          none: unrelated[0].replace("\n", "\n\n"),
          comment: withHeader("Comment: text"),
          notEncrypted: withHeader("Proc-Type: 4,MIC-ONLY"),
          unknownCipher: withHeader("Proc-Type: 4,ENCRYPTED\nDEK-Info: UNKNOWN,00"),
          halfABlock: encrypted(unrelated[0], "").replace(/\n\n[^-]*/, "\n\nAAAA\n"),
          ofAnotherType: key.replace("\n", "\nComment: text\n\n"),
        }),
      ).toEqual({
        none: true,
        comment: "ERR_OSSL_PEM_NOT_PROC_TYPE",
        notEncrypted: "ERR_OSSL_PEM_NOT_ENCRYPTED",
        unknownCipher: "ERR_OSSL_PEM_UNSUPPORTED_ENCRYPTION",
        halfABlock: "ERR_OSSL_PEM_BAD_DECRYPT",
        ofAnotherType: true,
      });
    });

    it("keeps the parameters of the signature algorithm of a certificate that it writes as DER", () => {
      const der = seq(fieldsOf(root)[0], seq(oid("2a0304"), seq(hex("020101"))), signature);
      const before = tls.getCACertificates("default");
      try {
        tls.setDefaultCACertificates([armor("CERTIFICATE", longForm(der))]);
        expect(tls.getCACertificates("default")).toEqual([armor("CERTIFICATE", der)]);
      } finally {
        tls.setDefaultCACertificates(before);
      }
    });

    it("is the only way to change them", () => {
      const before = tls.getCACertificates("default");
      try {
        tls.setDefaultCACertificates([root]);
        expect(() => (tls.createServer({ key, cert: chain }) as any).ca.push(unrelated[0])).toThrow(TypeError);
        expect(tls.getCACertificates("default")).toEqual([root]);
      } finally {
        tls.setDefaultCACertificates(before);
      }
    });

    it("ignores a byte order mark", () => {
      expect(outcomes({ byteOrderMark })).toEqual({ byteOrderMark: true });
    });
  });

  it("setDefaultCACertificates() sorts by SHA-1 fingerprint", () => {
    const before = tls.getCACertificates("default");
    const fingerprints = (pems: string[]) => pems.map(pem => new X509Certificate(pem).fingerprint);
    try {
      tls.setDefaultCACertificates([...unrelated, unrelated[0]]);
      expect(fingerprints(tls.getCACertificates("default"))).toEqual(fingerprints(unrelated).sort());
    } finally {
      tls.setDefaultCACertificates(before);
    }
  });

  it("the messages are those of OpenSSL 3", async () => {
    async function message(cert: string, ca: string) {
      await using server = await serve(cert);
      const [error] = await once(tls.connect({ host: "127.0.0.1", port: server.port, ca }), "error");
      return error.message.split(";")[0];
    }
    expect([
      await message(mint("self", "self", [], { subjectKey: leafKey, signer: leafKey }), root),
      await message(chain + root, unrelated[0]),
      await message(clientChain, root),
    ]).toEqual([
      "self-signed certificate",
      "self-signed certificate in certificate chain",
      "unsuitable certificate purpose",
    ]);
  });

  describe.concurrent("in the default store", () => {
    type Source = "NODE_EXTRA_CA_CERTS" | "SSL_CERT_FILE" | "SSL_CERT_DIR";
    const good = (name: string) => mint(name, name, ca);
    const bad = (name: string) => copy("CA:FALSE", "usual", name, name);

    /** Each case has a root name of its own, so that one process holds them all. */
    async function run(
      args: string[],
      cases: Record<string, (name: string) => Partial<Record<Source, string[]>>>,
      main = "main.mjs",
    ) {
      const files = { NODE_EXTRA_CA_CERTS: unrelated.slice(0, 20), SSL_CERT_FILE: unrelated.slice(20) };
      const hashed: Record<string, string> = {};
      const chains: Record<string, string> = {};
      for (const [name, sources] of Object.entries(cases)) {
        chains[name] = leaf + mint("intermediate", name, ca);
        const { SSL_CERT_DIR = [], ...lists } = sources(name);
        for (const [source, [first, ...rest]] of Object.entries(lists) as [keyof typeof files, string[]][]) {
          files[source] = [first, ...files[source], ...rest];
        }
        const digest = createHash("sha1").update(rdn("550403", name.toLowerCase())).digest();
        const hash = digest.subarray(0, 4).reverse().toString("hex");
        const count = { "": 0, "r": 0 };
        for (const file of SSL_CERT_DIR) {
          const type = file.includes("X509 CRL") ? "r" : "";
          hashed[`hashed/${hash}.${type}${count[type]++}`] = file;
        }
      }
      using dir = tempDir("same-subject", {
        ...hashed,
        "extra.pem": files.NODE_EXTRA_CA_CERTS.join(""),
        "file.pem": files.SSL_CERT_FILE.join(""),
        "plan.json": JSON.stringify({ key, chains, crl: crlOf("intermediate") }),
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
        "crl.mjs": `
          import { once } from "node:events";
          import { readFileSync } from "node:fs";
          import tls from "node:tls";
          const { key, chains, crl } = JSON.parse(readFileSync("plan.json", "utf8"));
          const outcomes = {};
          for (const [name, cert] of Object.entries(chains)) {
            const server = tls.createServer({ key, cert });
            await once(server.listen(0, "127.0.0.1"), "listening");
            const socket = tls.connect({ host: "127.0.0.1", port: server.address().port, servername: "localhost", crl });
            outcomes[name] = await once(socket, "secureConnect").then(() => "authorized", error => error.code);
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
          SSL_CERT_DIR: Object.keys(hashed).length ? join(String(dir), "hashed") : "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const warning = stderr
        .replace(String(dir), "")
        .replace(/error:.*/s, "error")
        .trim();
      return { outcomes: stdout && JSON.parse(stdout), exitCode, ...(stderr && { stderr: warning }) };
    }
    const extraWarning = `Warning: Ignoring extra certs from \`${sep}extra.pem\`, load failed: `;
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

    const fileFlags = isLinux ? ["--use-openssl-ca", "--use-system-ca"] : ["--use-openssl-ca"];
    const emptyRdn = seq(rdn("550403", "other"), hex("3100"));
    const before = (source: Source, entry: (name: string) => string) => (name: string) => ({
      [source]: [entry(name), good(name)],
    });
    const onlyOpenSSLReads = (source: Source) => ({
      validity: before(source, name => mint(name, name, ca, { to: "21XX" })),
      longForm: before(source, name => {
        const [tbs, ...rest] = fieldsOf(good(name));
        return armor("CERTIFICATE", seq(longForm(tbs), ...rest));
      }),
      emptyRdn: before(source, () => mint(emptyRdn, emptyRdn, ca)),
      trusted: before(source, name => {
        const broken = derOf(mint(name, name, ca, { to: "21XX" }));
        return armor("TRUSTED CERTIFICATE", Buffer.concat([broken, trustOnly(serverAuth)]));
      }),
    });
    const passedOver = { validity: authorized, longForm: authorized, emptyRdn: authorized, trusted: authorized };
    const missing = ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"];

    it.each(fileFlags)("a copy in SSL_CERT_FILE that does not parse is passed over with %s", async flag => {
      expect(await run([flag], onlyOpenSSLReads("SSL_CERT_FILE"))).toEqual({ outcomes: passedOver, exitCode: 0 });
    });

    it("one in NODE_EXTRA_CA_CERTS is too, with a warning unlike in Node.js", async () => {
      expect(await run([], onlyOpenSSLReads("NODE_EXTRA_CA_CERTS"))).toEqual({
        outcomes: passedOver,
        exitCode: 0,
        stderr: extraWarning + "only those that BoringSSL can parse were loaded",
      });
    });

    it("a malformed certificate ends NODE_EXTRA_CA_CERTS", async () => {
      const malformed = armor("CERTIFICATE", seq(contentsOf(derOf(root)), hex("0500")));
      expect(
        await run([], {
          after: name => ({ NODE_EXTRA_CA_CERTS: [malformed, good(name)] }),
          before: name => ({ NODE_EXTRA_CA_CERTS: [good(name)] }),
        }),
      ).toEqual({ outcomes: { after: missing, before: authorized }, exitCode: 0, stderr: extraWarning + "error" });
    });

    const cut = derOf(root).subarray(0, 100);
    const withHeader = root.replace("\n", "\nComment: text\n\n");

    it.each([
      ["a malformed certificate", armor("CERTIFICATE", cut)],
      ["a malformed TRUSTED CERTIFICATE", armor("TRUSTED CERTIFICATE", cut)],
      ["a malformed CRL", armor("X509 CRL", cut)],
      ["a field after a signature", armor("CERTIFICATE", seq(contentsOf(derOf(root)), hex("0500")))],
      ["a signature of another type", armor("CERTIFICATE", seq(...fieldsOf(root).slice(0, 2), hex("040100")))],
      ["a certificate with a header", withHeader],
    ])("nothing is taken from an SSL_CERT_FILE with %s", async (_, entry) => {
      expect(
        await run(["--use-openssl-ca"], {
          after: name => ({ SSL_CERT_FILE: [entry, good(name)] }),
          before: name => ({ SSL_CERT_FILE: [good(name)] }),
        }),
      ).toEqual({ outcomes: { after: missing, before: missing }, exitCode: 0 });
    });

    it("the CRLs in SSL_CERT_FILE count once `crl` asks for the check", async () => {
      expect(
        await run(
          ["--use-openssl-ca"],
          {
            with: name => ({ SSL_CERT_FILE: [good(name), crlOf(name)] }),
            without: name => ({ SSL_CERT_FILE: [good(name)] }),
          },
          "crl.mjs",
        ),
      ).toEqual({ outcomes: { with: "authorized", without: "UNABLE_TO_GET_CRL" }, exitCode: 0 });
    });

    it("so do those in SSL_CERT_DIR", async () => {
      const inLongForm = (name: string) => armor("X509 CRL", longForm(derOf(crlOf(name))));
      expect(
        await run(
          ["--use-openssl-ca"],
          {
            plain: name => ({ SSL_CERT_DIR: [good(name), crlOf(name)] }),
            longForm: name => ({ SSL_CERT_DIR: [good(name), inLongForm(name)] }),
            second: name => ({ SSL_CERT_DIR: [good(name), crlOf("other") + crlOf(name) + armor("X509 CRL", cut)] }),
            without: name => ({ SSL_CERT_DIR: [good(name)] }),
          },
          "crl.mjs",
        ),
      ).toEqual({
        outcomes: { plain: "authorized", longForm: "authorized", second: "authorized", without: "UNABLE_TO_GET_CRL" },
        exitCode: 0,
      });
    });

    it("the files in SSL_CERT_DIR are read like `ca`, but for NULs", async () => {
      const inFiles =
        (...files: ((pem: string) => string)[]) =>
        (name: string) => {
          const pem = good(name);
          return { SSL_CERT_DIR: files.map(file => file(pem)) };
        };
      const plain = (pem: string) => pem;
      const rejectedInLongForm = (pem: string) => {
        const [tbs, ...rest] = fieldsOf(pem);
        return armor("TRUSTED CERTIFICATE", Buffer.concat([seq(longForm(tbs), ...rest), reject(serverAuth)]));
      };
      expect(
        await run(["--use-openssl-ca"], {
          byteOrderMark: inFiles(pem => byteOrderMark + pem),
          longForm: inFiles(pem => armor("CERTIFICATE", longForm(derOf(pem)))),
          emptyPassphrase: inFiles(pem => encrypted(pem, "")),
          last: inFiles(pem => unrelated.join("") + pem),
          beforeMalformed: inFiles(pem => pem + armor("CERTIFICATE", cut)),
          afterMalformed: inFiles(pem => armor("CERTIFICATE", cut) + pem),
          rejectedWithMark: inFiles(pem => byteOrderMark + withSettings(pem, reject(serverAuth)), plain),
          rejectedWithAlias: inFiles(pem => withSettings(pem, seq(tlv(0xa0, serverAuth), hex("0c01e9"))), plain),
          rejectedInLongForm: inFiles(rejectedInLongForm, plain),
          rejectedWithNuls: inFiles(pem => withSettings(pem, reject(serverAuth)).replaceAll("\n", "\0junk\n"), plain),
          afterNul: inFiles(pem => unrelated[0] + "\0\n" + pem),
        }),
      ).toEqual({
        outcomes: {
          byteOrderMark: authorized,
          longForm: authorized,
          emptyPassphrase: authorized,
          last: authorized,
          beforeMalformed: authorized,
          afterMalformed: missing,
          rejectedWithMark: notACA,
          rejectedWithAlias: notACA,
          rejectedInLongForm: notACA,
          rejectedWithNuls: notACA,
          afterNul: missing,
        },
        exitCode: 0,
      });
    });

    it.skipIf(!isLinux)("a file of the system store is read up to a block that is malformed", async () => {
      const files = {
        "byte order mark": byteOrderMark + good("listed: byte order mark"),
        "padded": withSettings(good("listed: padded"), hex("0a"), "CERTIFICATE") + good("listed: after padded"),
        "long form": armor("CERTIFICATE", longForm(derOf(good("listed: long form")))),
        "empty RDN": mint(emptyRdn, emptyRdn, ca) + good("listed: after empty RDN"),
        "trusted": withSettings(good("left out: trusted"), hex("")) + good("listed: after trusted"),
        "cut": good("listed: before cut") + armor("CERTIFICATE", cut) + good("left out: after cut"),
        "header": withHeader + good("left out: after header"),
      };
      using dir = tempDir("system-store", files);
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-p",
          `require("node:tls").getCACertificates("system")
            .map(pem => new (require("node:crypto").X509Certificate)(pem).subject)
            .filter(subject => /listed|left out/.test(subject)).sort().join("\\n")`,
        ],
        env: { ...bunEnv, SSL_CERT_FILE: "", SSL_CERT_DIR: String(dir) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
        stdout: [
          "CN=listed: after empty RDN",
          "CN=listed: after padded",
          "CN=listed: after trusted",
          "CN=listed: before cut",
          "CN=listed: byte order mark",
          "CN=listed: long form",
          "CN=listed: padded",
        ],
        stderr: "",
        exitCode: 0,
      });
    });

    it.each(fileFlags)("byte order marks, padding and BER are read with %s", async flag => {
      const sources = ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"] as const;
      const cases = (label: string, change: (pem: string) => string) =>
        sources.map(source => [`${label} in ${source}`, (name: string) => ({ [source]: [change(good(name))] })]);
      const withField = (pem: string, index: number, field: Buffer) =>
        armor("CERTIFICATE", seq(...fieldsOf(pem).with(index, field)));
      const all = Object.fromEntries([
        ...cases("padded", pem => withSettings(pem, hex("0a"), "CERTIFICATE")),
        ...cases("long form", pem => armor("CERTIFICATE", longForm(derOf(pem)))),
        ...cases("algorithm", pem => withField(pem, 1, longForm(algorithms.ec))),
        ...cases("parameters", pem => withField(pem, 1, seq(contentsOf(algorithms.ec), hex("010101")))),
        ...cases("in pieces", pem => withField(pem, 2, hex("230403020001"))),
        ...cases("unused bits", pem => withField(pem, 2, hex("030207ff"))),
        ...cases("in the middle", pem => byteOrderMark + pem),
        ...cases("at the start", pem => byteOrderMark + pem),
      ]);
      expect(await run([flag], all)).toEqual({
        outcomes: Object.fromEntries(Object.keys(all).map(name => [name, authorized])),
        exitCode: 0,
      });
    });

    it.each([
      ["with --use-openssl-ca", ["--use-openssl-ca"]],
      ["without, unlike in Node.js", []],
    ])("trust settings in SSL_CERT_FILE that BoringSSL does not parse hold %s", async (_, args) => {
      const rejected = (name: string) => {
        const pem = good(name);
        return { SSL_CERT_FILE: [withSettings(pem, seq(tlv(0xa0, serverAuth), hex("0c01e9"))), pem] };
      };
      const longForms = (name: string) => {
        const pem = good(name);
        const [tbs, ...rest] = fieldsOf(pem);
        const entry = Buffer.concat([seq(longForm(tbs), ...rest), reject(serverAuth)]);
        return { SSL_CERT_FILE: [armor("TRUSTED CERTIFICATE", entry), pem] };
      };
      expect(await run(args, { rejected, longForms })).toEqual({
        outcomes: { rejected: notACA, longForms: notACA },
        exitCode: 0,
      });
    });

    it("what follows a plain certificate is not read as trust settings", async () => {
      const trailing = (name: string) => [withSettings(good(name), reject(serverAuth), "CERTIFICATE")];
      expect(
        await run(["--use-openssl-ca"], {
          extra: name => ({ NODE_EXTRA_CA_CERTS: trailing(name) }),
          file: name => ({ SSL_CERT_FILE: trailing(name) }),
        }),
      ).toEqual({ outcomes: { extra: authorized, file: authorized }, exitCode: 0 });
    });

    it("NODE_EXTRA_CA_CERTS skips a TRUSTED CERTIFICATE", async () => {
      const trusted = (name: string) => ({ NODE_EXTRA_CA_CERTS: [withSettings(good(name), trustOnly(serverAuth))] });
      expect(await run([], { trusted })).toEqual({
        outcomes: { trusted: ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"] },
        exitCode: 0,
      });
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

    it("a TRUSTED CERTIFICATE keeps its place in SSL_CERT_FILE", async () => {
      const both = (rejectedFirst: boolean) => (name: string) => {
        const pem = good(name);
        const copies = [pem, withSettings(pem, reject(serverAuth))];
        return { SSL_CERT_FILE: rejectedFirst ? copies.reverse() : copies };
      };
      expect(await run(["--use-openssl-ca"], { last: both(false), first: both(true) })).toEqual({
        outcomes: { last: authorized, first: notACA },
        exitCode: 0,
      });
    });

    /** With `root` among the default roots. */
    async function clientsAndServers(values: string, defaults?: string[]) {
      using dir = tempDir("empty-ca", { "extra.pem": root });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { once } = require("node:events"), https = require("node:https"), tls = require("node:tls");
          const identity = ${JSON.stringify({ key, cert: chain })};
          const client = ${JSON.stringify({ key, cert: clientChain })};
          const outcome = (emitter, event) => once(emitter, event).then(() => "authorized", error => error.code);
          async function listen(module, options) {
            const server = module.createServer({ ...identity, ...options }).listen(0, "127.0.0.1");
            await once(server, "listening");
            return [server, { port: server.address().port, host: "127.0.0.1" }];
          }
          async function outcomes(address, ca) {
            const out = [
              await outcome(tls.connect({ ...address, ca }), "secureConnect"),
              await outcome(https.get({ ...address, ca, agent: false }).on("socket", socket => {
                socket.on("secureConnect", () => socket.emit("error", { code: "authorized" }));
              }), "response"),
            ];
            for (const module of [tls, https]) {
              const [server, address] = await listen(module, { ca, requestCert: true, rejectUnauthorized: false });
              tls.connect({ ...address, ...client, rejectUnauthorized: false }).on("error", () => {});
              const [peer] = await once(server, "secureConnection");
              out.push(peer.authorized ? "authorized" : peer.authorizationError);
            }
            return [...new Set(out)].join();
          }
          (async () => {
            const [, address] = await listen(https, {});
            ${defaults ? `tls.setDefaultCACertificates(${JSON.stringify(defaults)});` : ""}
            console.log((await Promise.all(${values}.map(ca => outcomes(address, ca)))).join("\\n"));
            process.exit(0);
          })();`,
        ],
        env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "extra.pem") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim().split("\n"), stderr, exitCode };
    }

    it.each([
      ["nothing", [], missing[0]],
      ["another root", [unrelated[0]], missing[0]],
      ["the root", [root], "authorized"],
    ])("setDefaultCACertificates() of %s is for any falsy `ca`", async (_, defaults, outcome) => {
      expect(await clientsAndServers(`[undefined, "", false]`, defaults)).toEqual({
        stdout: [outcome, outcome, outcome],
        stderr: "",
        exitCode: 0,
      });
    });

    it("a `ca` without certificates trusts nothing", async () => {
      expect(await clientsAndServers(`[undefined, "", [], [""], "/path/to/ca.pem", Buffer.alloc(0)]`)).toEqual({
        stdout: ["authorized", "authorized", ...Array(4).fill(missing[0])],
        stderr: "",
        exitCode: 0,
      });
    });

    it("nor does it get the sockets and sessions of an agent that have no `ca`, unlike in Node.js", () => {
      const agent = new https.Agent();
      const names = [[], [""], Buffer.alloc(0)].map(ca => agent.getName({ ca }));
      expect(names.includes(agent.getName({}))).toBe(false);
    });

    it("the same goes for the built-in ws and node-fetch", async () => {
      await using server = await serve(chain);
      server.on("upgrade", (_, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
      using dir = tempDir("empty-ca", { "extra.pem": root });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import fetch from "node-fetch";
          import { once } from "node:events";
          import { Agent } from "node:https";
          import net from "node:net";
          import WebSocket from "ws";
          const url = "https://127.0.0.1:${server.port}";
          const tunnel = net.createServer(socket => socket.on("error", () => {}).once("data", () => {
            socket.write("HTTP/1.1 200 OK\\r\\n\\r\\n");
            socket.pipe(net.connect(${server.port}, "127.0.0.1").on("error", () => {})).pipe(socket);
          }));
          await once(tunnel.listen(0, "127.0.0.1"), "listening");
          const proxy = "http://127.0.0.1:" + tunnel.address().port;
          const open = options => once(new WebSocket(url, options), "error").then(([error]) => error.code ?? "authorized");
          for (const ca of [undefined, [], "text"]) {
            const outcomes = new Set([await open({ ca, proxy })]);
            for (const options of [{ ca }, { ca, minVersion: "TLSv1.2" }]) {
              outcomes.add(await open(options));
              outcomes.add(await fetch(url, { agent: new Agent(options) }).then(res => res.text(), error => error.code));
            }
            console.log(...outcomes);
          }
          process.exit(0);`,
        ],
        env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "extra.pem"), NO_PROXY: "", no_proxy: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
        stdout: ["authorized", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"],
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
