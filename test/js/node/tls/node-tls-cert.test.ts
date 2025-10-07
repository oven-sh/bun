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

// The certificates aren't for "localhost", so override the identity check.
function checkServerIdentity(hostname: string, cert: any) {
  expect(hostname).toBe("localhost");
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

// TODO: this requires maxVersion/minVersion
it.todo("Request cert from TLS1.2 client that doesn't have one.", async () => {
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
    expect(err.code).toBe("ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE");
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

  for (const invalid of ["not-exist.pem", "", " "]) {
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

    expect(await proc.exited).toBe(1);
    const stderr = await proc.stderr.text();
    expect(stderr).toContain("UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
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

  for (const invalid of [mixedValidAndInvalidCertsBundlePath, mixedInvalidAndValidCertsBundlePath]) {
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

    expect(await proc.exited).toBe(1);
    const stderr = await proc.stderr.text();
    expect(stderr).toContain("ignoring extra certs");
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
