import { describe, expect, it } from "bun:test";
import { once } from "events";
import { readFileSync } from "fs";
import { bunEnv, bunExe, invalidTls, tmpdirSync } from "harness";
import type { AddressInfo } from "node:net";
import type { Server, TLSSocket } from "node:tls";
import { join } from "path";
import tls from "tls";
const clientTls = {
  key: readFileSync(join(import.meta.dir, "fixtures", "ec10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "ec10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca5-cert.pem"), "utf8"),
};
const serverTls = {
  key: readFileSync(join(import.meta.dir, "fixtures", "agent10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "agent10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca2-cert.pem"), "utf8"),
};

function split(file: any, into: any) {
  const certs = /([^]*END CERTIFICATE-----\r?\n)(-----BEGIN[^]*)/.exec(file) as RegExpExecArray;
  into.single = certs[1];
  into.subca = certs[2];
}

// Split out the single end-entity cert and the subordinate CA for later use.
split(clientTls.cert, clientTls);
split(serverTls.cert, serverTls);

// The certificates aren't for "127.0.0.1", so override the identity check.
function checkServerIdentity(hostname: string, cert: any) {
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
    expect(serverSocket.authorizationError).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
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

it("tls.connect should not accept untrusted certificates", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  let server: Server | null = null;
  let socket: TLSSocket | null = null;

  try {
    server = tls
      .createServer({
        key: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.key")),
        cert: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.crt")),
        passphrase: "123123123",
      })
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
    expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(err.message).toBe("unable to verify the first certificate");
  } finally {
    //@ts-ignore
    socket?.end();
    server?.close();
  }
});

it("tls.connect with rejectUnauthorized: null still rejects untrusted certificates", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  let server: Server | null = null;
  let socket: TLSSocket | null = null;

  try {
    server = tls
      .createServer({
        key: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.key")),
        cert: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.crt")),
        passphrase: "123123123",
      })
      .on("error", reject)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;
        socket = tls
          .connect({ port: address.port, rejectUnauthorized: null as unknown as boolean }, () => {
            reject(new Error("secureConnect must not fire when verification failed"));
          })
          .on("error", resolve);
      });

    const err = await promise;
    expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  } finally {
    socket?.end();
    server?.close();
  }
});

it("tls.connect with rejectUnauthorized: 0 keeps verification on like node", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  let server: Server | null = null;
  let socket: TLSSocket | null = null;

  try {
    server = tls
      .createServer({
        key: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.key")),
        cert: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.crt")),
        passphrase: "123123123",
      })
      .on("error", reject)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;
        socket = tls
          .connect({ port: address.port, rejectUnauthorized: 0 as unknown as boolean }, () => {
            reject(new Error("secureConnect must not fire when verification failed"));
          })
          .on("error", resolve);
      });

    const err = await promise;
    expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  } finally {
    socket?.end();
    server?.close();
  }
});

it("tls.createServer with rejectUnauthorized: 0 still rejects a client with an untrusted certificate", async () => {
  let server: Server | null = null;
  let socket: TLSSocket | null = null;
  const secureConnections: string[] = [];
  const clientErrors = Promise.withResolvers<Error>();
  const clientClosed = Promise.withResolvers<string>();
  const serverTLS = {
    key: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.key")),
    cert: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.crt")),
    passphrase: "123123123",
  };

  try {
    server = tls
      .createServer(
        {
          ...serverTLS,
          requestCert: true,
          rejectUnauthorized: 0 as unknown as boolean,
        },
        s => {
          secureConnections.push(s.authorizationError as string);
          s.write("admitted");
        },
      )
      .on("tlsClientError", clientErrors.resolve)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;
        socket = tls.connect({ port: address.port, rejectUnauthorized: false, ...serverTLS });
        let received = "";
        socket.on("data", chunk => (received += chunk));
        socket.on("error", () => {});
        socket.on("close", () => clientClosed.resolve(received));
      });

    const [, received] = await Promise.all([clientErrors.promise, clientClosed.promise]);
    expect({ secureConnections, received }).toEqual({ secureConnections: [], received: "" });
  } finally {
    socket?.end();
    server?.close();
  }
});

it("tls.createServer with rejectUnauthorized: null still rejects unauthorized clients", async () => {
  let server: Server | null = null;
  let socket: TLSSocket | null = null;
  const secureConnections: string[] = [];
  const clientErrors = Promise.withResolvers<Error>();
  const clientClosed = Promise.withResolvers<string>();

  try {
    server = tls
      .createServer(
        {
          key: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.key")),
          cert: readFileSync(join(import.meta.dir, "..", "http", "fixtures", "openssl.crt")),
          passphrase: "123123123",
          requestCert: true,
          rejectUnauthorized: null as unknown as boolean,
        },
        s => {
          secureConnections.push(s.authorizationError as string);
          s.write("admitted");
        },
      )
      .on("tlsClientError", clientErrors.resolve)
      .listen(0, () => {
        const address = server?.address() as AddressInfo;
        socket = tls.connect({ port: address.port, rejectUnauthorized: false });
        let received = "";
        socket.on("data", chunk => (received += chunk));
        socket.on("error", () => {});
        socket.on("close", () => clientClosed.resolve(received));
      });

    const [err, received] = await Promise.all([clientErrors.promise, clientClosed.promise]);
    expect({ secureConnections, received, code: (err as NodeJS.ErrnoException).code }).toEqual({
      secureConnections: [],
      received: "",
      code: "ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE",
    });
  } finally {
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
    expect(stderr).toContain("ignoring extra certs");
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
