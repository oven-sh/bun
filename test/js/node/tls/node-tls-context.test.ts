// This test ensures that when a TLS connection is established, the server
// selects the most recently added SecureContext that matches the servername.

import { describe, expect, it } from "bun:test";

import { bunEnv, bunExe, tempDir } from "harness";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { AddressInfo } from "node:net";
import { join } from "node:path";
import tls from "node:tls";

function loadPEM(filename: string) {
  return readFileSync(join(import.meta.dir, "fixtures", filename)).toString();
}

const agent1Cert = loadPEM("agent1-cert.pem");
const agent1Key = loadPEM("agent1-key.pem");

const agent2Cert = loadPEM("agent2-cert.pem");
const agent2Key = loadPEM("agent2-key.pem");

const agent3Cert = loadPEM("agent3-cert.pem");
const agent3Key = loadPEM("agent3-key.pem");

const agent6Cert = loadPEM("agent6-cert.pem");
const agent6Key = loadPEM("agent6-key.pem");

const ca1 = loadPEM("ca1-cert.pem");
const ca2 = loadPEM("ca2-cert.pem");

const SNIContexts = {
  "a.example.com": {
    key: agent1Key,
    cert: agent1Cert,
  },
  "asterisk.test.com": {
    key: agent3Key,
    cert: agent3Cert,
  },
  "chain.example.com": {
    key: agent6Key,
    // NOTE: Contains ca3 chain cert
    cert: agent6Cert,
  },
};

const serverOptions = {
  key: agent2Key,
  cert: agent2Cert,
  requestCert: true,
  rejectUnauthorized: false,
};

const badSecureContext = {
  key: agent1Key,
  cert: agent1Cert,
  ca: [ca2],
};

const goodSecureContext = {
  key: agent1Key,
  cert: agent1Cert,
  ca: [ca1],
};

describe("tls.Server", () => {
  it("addContext", async () => {
    const serverOptions = {
      key: agent2Key,
      cert: agent2Cert,
      ca: [ca2],
      requestCert: true,
      rejectUnauthorized: false,
    };

    let connections = 0;
    const { promise, resolve, reject } = Promise.withResolvers();
    let listening_server: tls.Server | null = null;
    try {
      listening_server = tls.createServer(serverOptions, async c => {
        try {
          if (++connections === 3) {
            resolve();
          }
          //@ts-ignore
          if (c.servername === "unknowncontext") {
            expect(c.authorized).toBe(false);
            return;
          }
          expect(c.authorized).toBe(true);
        } catch (e) {
          reject(e);
        }
      });
      const server = listening_server as tls.Server;

      const secureContext = {
        key: agent1Key,
        cert: agent1Cert,
        ca: [ca1],
      };
      server.addContext("context1", secureContext);
      //@ts-ignore
      server.addContext("context2", tls.createSecureContext(secureContext));

      const clientOptionsBase = {
        key: agent1Key,
        cert: agent1Cert,
        ca: [ca1],
        rejectUnauthorized: false,
      };

      function connect(servername: string) {
        return new Promise<void>((resolve, reject) => {
          const client = tls.connect(
            {
              ...clientOptionsBase,
              port: (server.address() as AddressInfo).port,
              host: "127.0.0.1",
              servername,
            },
            () => {
              client.end();
              resolve();
            },
          );
          client.on("error", reject);
        });
      }

      server.listen(0, async () => {
        await connect("context1");
        await connect("context2");
        await connect("unknowncontext");
      });
      await promise;
    } finally {
      listening_server?.close();
    }
  });

  it("should select the most recently added SecureContext", async () => {
    let listening_server: tls.Server | null = null;
    const { promise, resolve, reject } = Promise.withResolvers();
    try {
      const timeout = setTimeout(() => {
        reject("timeout");
      }, 3000);
      listening_server = tls.createServer(serverOptions, c => {
        try {
          // The 'a' and 'b' subdomains are used to distinguish between client
          // connections.
          // Connection to subdomain 'a' is made when the 'bad' secure context is
          // the only one in use.
          //@ts-ignore
          if ("a.example.com" === c.servername) {
            expect(c.authorized).toBe(false);
          }
          // Connection to subdomain 'b' is made after the 'good' context has been
          // added.
          //@ts-ignore
          if ("b.example.com" === c.servername) {
            expect(c.authorized).toBe(true);
            clearTimeout(timeout);
            resolve();
          }
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
      const server = listening_server as tls.Server;
      // 1. Add the 'bad' secure context. A connection using this context will not be
      // authorized.
      server.addContext("*.example.com", badSecureContext);

      server.listen(0, () => {
        const options = {
          port: (server?.address() as AddressInfo).port,
          host: "127.0.0.1",
          key: agent1Key,
          cert: agent1Cert,
          ca: [ca1],
          servername: "a.example.com",
          rejectUnauthorized: false,
        };

        // 2. Make a connection using servername 'a.example.com'. Since a 'bad'
        // secure context is used, this connection should not be authorized.
        const client = tls.connect(options, () => {
          client.end();
        });

        client.on("close", () => {
          // 3. Add a 'good' secure context.
          server.addContext("*.example.com", goodSecureContext);

          options.servername = "b.example.com";
          // 4. Make a connection using servername 'b.example.com'. This connection
          // should be authorized because the 'good' secure context is the most
          // recently added matching context.

          const other = tls.connect(options, () => {
            other.end();
          });

          other.on("close", () => {
            // 5. Make another connection using servername 'b.example.com' to ensure
            // that the array of secure contexts is not reversed in place with each
            // SNICallback call, as someone might be tempted to refactor this piece of
            // code by using Array.prototype.reverse() method.
            const onemore = tls.connect(options, () => {
              onemore.end();
            });

            onemore.on("close", () => {
              server.close();
            });
            onemore.on("error", reject);
          });

          other.on("error", reject);
        });
        client.on("error", reject);
      });
      server.on("error", reject);
      server.on("clientError", reject);

      await promise;
    } finally {
      listening_server?.close();
    }
  });

  function testCA(ca: Array<string>) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = tls.createServer({ ca, cert: agent3Cert, key: agent3Key });

    server.addContext("agent3", { ca, cert: agent3Cert, key: agent3Key });
    server.listen(0, "127.0.0.1", () => {
      const options = {
        servername: "agent3",
        host: "127.0.0.1",
        port: (server.address() as AddressInfo).port,
        ca,
      };
      var authorized = false;
      const socket = tls.connect(options, () => {
        authorized = socket.authorized;
        socket.end();
      });

      socket.on("error", reject);
      socket.on("close", () => {
        server.close(() => {
          resolve(authorized);
        });
      });
    });
    return promise;
  }
  it("should allow multiple CA", async () => {
    // Verify that multiple CA certificates can be provided, and that for
    // convenience that can also be in newline-separated strings.
    expect(await testCA([ca1, ca2])).toBeTrue();
  });

  it("should allow multiple CA in newline-separated strings", async () => {
    expect(await testCA([ca2 + "\n" + ca1])).toBeTrue();
  });

  function testClient(options: any, clientResult: boolean, serverResult: string) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = tls.createServer(serverOptions, c => {
      try {
        //@ts-ignore
        expect(c.servername).toBe(serverResult);
        expect(c.authorized).toBe(false);
      } catch (e) {
        reject(e);
      }
    });

    server.addContext("a.example.com", SNIContexts["a.example.com"]);
    server.addContext("*.test.com", SNIContexts["asterisk.test.com"]);
    server.addContext("chain.example.com", SNIContexts["chain.example.com"]);

    server.on("tlsClientError", reject);

    server.listen(0, () => {
      const client = tls.connect(
        {
          ...options,
          port: (server.address() as AddressInfo).port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
        },
        () => {
          const result =
            //@ts-ignore
            client.authorizationError && client.authorizationError.indexOf("ERR_TLS_CERT_ALTNAME_INVALID") !== -1;
          if (result !== clientResult) {
            reject(new Error(`Expected ${clientResult}, got ${result} in ${options.servername}`));
          } else {
            resolve();
          }
          client.end();
        },
      );
      client.on("error", reject);
      client.on("close", () => {
        server.close();
      });
    });
    return promise;
  }
  it("SNI tls.Server + tls.connect", async () => {
    await testClient(
      {
        ca: [ca1],
        servername: "a.example.com",
      },
      true,
      "a.example.com",
    );
    await testClient(
      {
        ca: [ca2],
        servername: "b.test.com",
      },
      true,
      "b.test.com",
    );
    await testClient(
      {
        ca: [ca2],
        servername: "a.b.test.com",
      },
      false,
      "a.b.test.com",
    );
    await testClient(
      {
        ca: [ca1],
        servername: "c.wrong.com",
      },
      false,
      "c.wrong.com",
    );
    await testClient(
      {
        ca: [ca1],
        servername: "chain.example.com",
      },
      true,
      "chain.example.com",
    );
  });
});

describe("Bun.serve SNI", () => {
  function doClientRequest(options: any) {
    return new Promise((resolve, reject) => {
      const client = tls.connect(
        {
          ...options,
          rejectUnauthorized: false,
        },
        () => {
          resolve(
            //@ts-ignore
            client.authorizationError && client.authorizationError.indexOf("ERR_TLS_CERT_ALTNAME_INVALID") !== -1,
          );
        },
      );
      client.on("close", resolve);
      client.on("error", reject);
    });
  }
  it("single SNI", async () => {
    {
      using server = Bun.serve({
        port: 0,
        tls: {
          ...SNIContexts["asterisk.test.com"],
          serverName: "*.test.com",
        },
        fetch(req, res) {
          return new Response(new URL(req.url).hostname);
        },
      });
      for (const servername of ["a.test.com", "b.test.com", "c.test.com"]) {
        const client = await doClientRequest({
          ...SNIContexts["asterisk.test.com"],
          port: server.port,
          ca: [ca2],
          servername,
        });
        expect(client).toBe(true);
      }
      {
        const client = await doClientRequest({
          ...goodSecureContext,
          port: server.port,
          servername: "a.example.com",
        });
        expect(client).toBe(false);
      }
    }
    {
      using server = Bun.serve({
        port: 0,
        tls: {
          ...goodSecureContext,
          serverName: "*.example.com",
        },
        fetch(req, res) {
          return new Response(new URL(req.url).hostname);
        },
      });
      {
        const client = await doClientRequest({
          ...goodSecureContext,
          port: server.port,
          servername: "a.example.com",
        });
        expect(client).toBe(true);
      }

      {
        const client = await doClientRequest({
          ...goodSecureContext,
          port: server.port,
          servername: "b.example.com",
        });
        expect(client).toBe(true);
      }
    }
  });
  it("multiple SNI", async () => {
    {
      using server = Bun.serve({
        port: 0,
        tls: [
          serverOptions,
          {
            serverName: "a.example.com",
            ...SNIContexts["a.example.com"],
          },
          {
            serverName: "*.test.com",
            ...SNIContexts["asterisk.test.com"],
          },
          {
            serverName: "chain.example.com",
            ...SNIContexts["chain.example.com"],
          },
        ],
        fetch(req, res) {
          return new Response("OK");
        },
      });
      expect(
        await doClientRequest({
          ca: [ca1],
          servername: "a.example.com",
          port: server.port,
        }),
      ).toBe(true);
      expect(
        await doClientRequest({
          ca: [ca2],
          servername: "b.test.com",
          port: server.port,
        }),
      ).toBe(true);

      expect(
        await doClientRequest({
          ca: [ca2],
          servername: "a.b.test.com",
          port: server.port,
        }),
      ).toBe(false);

      expect(
        await doClientRequest({
          ca: [ca1],
          servername: "c.wrong.com",
          port: server.port,
        }),
      ).toBe(false);
      expect(
        await doClientRequest({
          ca: [ca1],
          servername: "chain.example.com",
          port: server.port,
        }),
      ).toBe(true);
    }
  });
});

describe("server certificate chain built from `ca`", () => {
  it("presents an intermediate known only to the default store (NODE_EXTRA_CA_CERTS)", async () => {
    // With no `ca`, Node seeds the context's store with the default roots
    // (which include NODE_EXTRA_CA_CERTS) and the handshake-time auto-chain
    // completes a leaf-only `cert` from it. The client trusts ONLY the root
    // (an explicit `ca` replaces its default store), so it can verify iff the
    // server actually sent the intermediate.
    const [agent6Leaf, ca3Cert] = agent6Cert.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const ca3Serial = new X509Certificate(ca3Cert).serialNumber.toUpperCase();
    using dir = tempDir("extra-ca-auto-chain", {
      "intermediate.pem": ca3Cert,
      "leaf.pem": agent6Leaf,
      "key.pem": agent6Key,
      "root.pem": ca1,
      "main.ts": `
        import tls from "node:tls";
        import { readFileSync } from "node:fs";
        const server = tls.createServer(
          { key: readFileSync("key.pem"), cert: readFileSync("leaf.pem") },
          s => s.end(),
        );
        server.on("tlsClientError", e => { console.error("tlsClientError: " + e); process.exit(1); });
        server.listen(0, () => {
          const socket = tls.connect(
            {
              port: server.address().port,
              ca: [readFileSync("root.pem")],
              rejectUnauthorized: false,
              checkServerIdentity: () => undefined,
            },
            () => {
              const serials = [];
              let cur = socket.getPeerCertificate(true);
              while (cur) {
                serials.push(String(cur.serialNumber).toUpperCase());
                const issuer = cur.issuerCertificate;
                if (!issuer || issuer === cur) break;
                cur = issuer;
              }
              console.log(JSON.stringify({ authorized: socket.authorized, serials }));
              socket.end();
              server.close();
            },
          );
          socket.on("error", e => { console.error("client error: " + e); process.exit(1); });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "intermediate.pem") },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const got = exitCode === 0 ? JSON.parse(stdout.trim()) : { authorized: false, serials: [] };
    expect({
      authorized: got.authorized,
      presentedIntermediate: got.serials.includes(ca3Serial),
      exitCode,
      failureDetail: exitCode === 0 ? "" : stderr,
    }).toEqual({ authorized: true, presentedIntermediate: true, exitCode: 0, failureDetail: "" });
  });

  // Node never presents the whole `ca` set: OpenSSL auto-chain walks the
  // trust store from the leaf and sends only the resulting issuer path.
  it("does not present `ca` entries unrelated to the leaf's issuer chain", async () => {
    // agent6-cert.pem is the agent6 leaf followed by the ca3 intermediate
    // that signed it; ca2 is a trust anchor unrelated to that chain.
    const [agent6Leaf, ca3Cert] = agent6Cert.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const ca2Serial = new X509Certificate(ca2).serialNumber.toUpperCase();
    const ca3Serial = new X509Certificate(ca3Cert).serialNumber.toUpperCase();
    const server = tls.createServer({ key: agent6Key, cert: agent6Leaf, ca: [ca3Cert, ca2] }, s => s.end());
    // Any server-side failure must reject the awaited steps below instead of
    // letting the test hang to the suite timeout.
    const failure = Promise.withResolvers<never>();
    server.on("error", failure.reject);
    server.on("tlsClientError", failure.reject);
    let socket: tls.TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.listen(0, listening.resolve);
      await Promise.race([listening.promise, failure.promise]);
      const secured = Promise.withResolvers<void>();
      socket = tls.connect(
        {
          port: (server.address() as AddressInfo).port,
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        secured.resolve,
      );
      socket.on("error", secured.reject);
      await Promise.race([secured.promise, failure.promise]);
      const presentedSerials: string[] = [];
      let current: any = socket.getPeerCertificate(true);
      while (current) {
        presentedSerials.push(String(current.serialNumber).toUpperCase());
        const issuer = current.issuerCertificate;
        if (!issuer || issuer === current) break;
        current = issuer;
      }
      expect(presentedSerials).toContain(ca3Serial);
      expect(presentedSerials).not.toContain(ca2Serial);
    } finally {
      socket?.destroy();
      server.close();
    }
  });

  it("presents the issuer path when the leaf and intermediate are loaded from files", async () => {
    // Same auto-chain rule for the `certFile`/`caFile` loading path.
    const [agent6Leaf, ca3Cert] = agent6Cert.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const ca3Serial = new X509Certificate(ca3Cert).serialNumber.toUpperCase();
    using dir = tempDir("tls-cafile-chain", {
      "leaf.pem": agent6Leaf,
      "ca3.pem": ca3Cert,
      "key.pem": agent6Key,
    });
    using server = Bun.serve({
      port: 0,
      tls: {
        keyFile: join(String(dir), "key.pem"),
        certFile: join(String(dir), "leaf.pem"),
        caFile: join(String(dir), "ca3.pem"),
      },
      fetch: () => new Response("ok"),
    });
    const secured = Promise.withResolvers<void>();
    const socket = tls.connect(
      { port: server.port, rejectUnauthorized: false, checkServerIdentity: () => undefined },
      secured.resolve,
    );
    socket.on("error", secured.reject);
    try {
      await secured.promise;
      const presentedSerials: string[] = [];
      let current: any = socket.getPeerCertificate(true);
      while (current) {
        presentedSerials.push(String(current.serialNumber).toUpperCase());
        const issuer = current.issuerCertificate;
        if (!issuer || issuer === current) break;
        current = issuer;
      }
      expect(presentedSerials).toContain(ca3Serial);
    } finally {
      socket.destroy();
    }
  });
});

it("rejects a non-string ecdhCurve like Node's validateString", () => {
  // Node: configSecureContext destructures ecdhCurve with a default and passes
  // it through validateString - only the type is checked in JS, an unsupported
  // name is left to the native SSL_CTX_set1_groups_list call.
  for (const bad of [null, 42, {}]) {
    let err: any;
    try {
      tls.createSecureContext({ ecdhCurve: bad as any });
    } catch (e) {
      err = e;
    }
    expect({ code: err?.code, input: bad }).toEqual({ code: "ERR_INVALID_ARG_TYPE", input: bad });
  }
});

it("rejects an unparseable crl with Node's error shape", () => {
  // Node's SetCRL wraps the parse in ClearErrorOnReturn and throws
  // ERR_CRYPTO_OPERATION_FAILED("Failed to parse CRL"), no OpenSSL decoration:
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1893-L1903
  // https://github.com/nodejs/node/blob/v26.3.0/test/parallel/test-crypto.js#L291-L298
  let err: any;
  try {
    tls.createSecureContext({ crl: "not a CRL" });
  } catch (e) {
    err = e;
  }
  expect({
    name: err?.name,
    code: err?.code,
    message: err?.message,
    hasOpensslErrorStack: "opensslErrorStack" in (err ?? {}),
  }).toEqual({
    name: "Error",
    code: "ERR_CRYPTO_OPERATION_FAILED",
    message: "Failed to parse CRL",
    hasOpensslErrorStack: false,
  });
});

it("validates crl the same way on both createSecureContext and Server.setSecureContext", () => {
  // Node validates crl via validateKeyOrCertOption in configSecureContext,
  // which both createSecureContext and tls.Server use:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L261-L269
  for (const build of [
    () => tls.createSecureContext({ crl: 123 as never }),
    () => tls.createServer({ crl: 123 as never }),
  ]) {
    let err: any;
    try {
      build();
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_INVALID_ARG_TYPE");
  }
});

it("accepts BoringSSL kCipherAliases selectors that are not literal suite names", () => {
  // vendor/boringssl/ssl/ssl_cipher.cc kCipherAliases: AES128, AES256, kPSK,
  // aPSK, FIPS all match a non-empty cipher list. Node built against BoringSSL
  // accepts them; a JS-side pre-check must not reject what the parser accepts.
  for (const ciphers of ["AES128", "AES256", "FIPS", "kPSK", "aPSK"]) {
    expect(() => tls.createSecureContext({ ciphers })).not.toThrow();
  }
});

it("validates sigalgs on every secure context like Node's configSecureContext", () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L213-L217
  expect(() => tls.createSecureContext({ sigalgs: "" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
  expect(() => tls.createSecureContext({ sigalgs: 42 as never })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
});
