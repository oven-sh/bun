// This test ensures that when a TLS connection is established, the server
// selects the most recently added SecureContext that matches the servername.

import { describe, expect, it } from "bun:test";

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

// Regression: https://github.com/oven-sh/bun/issues/30485
// `tls.createSecureContext().context.addCACert` used to be `undefined` — the
// native SecureContext prototype was empty.
describe("tls.createSecureContext().context.addCACert", () => {
  it("is a function on the native context", () => {
    const ctx = tls.createSecureContext();
    expect(typeof ctx.context.addCACert).toBe("function");
  });

  it("accepts no arg options (Node parity)", () => {
    // Node: `createSecureContext()` with no argument is equivalent to `{}`.
    // Previously threw `TLSOptions must be an object` in Bun.
    const ctx = tls.createSecureContext();
    expect(typeof ctx.context.addCACert).toBe("function");
  });

  it("makes the added CA trusted on a fresh context", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ authorized: boolean; error: any }>();
    await using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: agent1Cert, key: agent1Key },
      socket: {
        data() {},
        error() {},
        open(s) {
          s.end();
        },
      },
    });

    const ctx = tls.createSecureContext();
    ctx.context.addCACert(ca1);

    const client = tls.connect(
      {
        port: server.port,
        host: "127.0.0.1",
        secureContext: ctx,
        rejectUnauthorized: false,
        servername: "agent1",
      },
      () => {
        resolve({ authorized: client.authorized, error: (client as any).authorizationError });
        client.end();
      },
    );
    client.on("error", reject);

    const result = await promise;
    expect(result.authorized).toBe(true);
  });

  it("rejects a cert signed by a different CA (added CA is not wildcard-trusted)", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ authorized: boolean; error: any }>();
    await using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: agent1Cert, key: agent1Key },
      socket: {
        data() {},
        error() {},
        open(s) {
          s.end();
        },
      },
    });

    // Add ca2 — server cert is signed by ca1, so authorization must fail.
    const ctx = tls.createSecureContext();
    ctx.context.addCACert(ca2);

    const client = tls.connect(
      {
        port: server.port,
        host: "127.0.0.1",
        secureContext: ctx,
        rejectUnauthorized: false,
        servername: "agent1",
      },
      () => {
        resolve({ authorized: client.authorized, error: (client as any).authorizationError });
        client.end();
      },
    );
    client.on("error", reject);

    const result = await promise;
    expect(result.authorized).toBe(false);
    expect(String(result.error)).toMatch(/UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|CERT/);
  });

  it("accepts Buffer input in addition to string", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    await using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: agent1Cert, key: agent1Key },
      socket: {
        data() {},
        error() {},
        open(s) {
          s.end();
        },
      },
    });

    const ctx = tls.createSecureContext();
    ctx.context.addCACert(Buffer.from(ca1));

    const client = tls.connect(
      {
        port: server.port,
        host: "127.0.0.1",
        secureContext: ctx,
        rejectUnauthorized: false,
        servername: "agent1",
      },
      () => {
        resolve(client.authorized);
        client.end();
      },
    );
    client.on("error", reject);

    expect(await promise).toBe(true);
  });

  it("silently ignores non-PEM input (Node parity)", () => {
    // Node's addCACert is lenient — it doesn't throw on malformed input,
    // empty strings, or anything that doesn't coerce to bytes it recognises.
    const ctx = tls.createSecureContext();
    expect(() => ctx.context.addCACert("")).not.toThrow();
    expect(() => ctx.context.addCACert("not pem")).not.toThrow();
    expect(() => ctx.context.addCACert(Buffer.alloc(0))).not.toThrow();
    expect(() => ctx.context.addCACert(null)).not.toThrow();
    expect(() => ctx.context.addCACert(undefined)).not.toThrow();
    expect(() => ctx.context.addCACert(42)).not.toThrow();
    expect(() => ctx.context.addCACert({})).not.toThrow();
  });

  it("is idempotent on duplicate CAs", () => {
    const ctx = tls.createSecureContext();
    expect(() => ctx.context.addCACert(ca1)).not.toThrow();
    expect(() => ctx.context.addCACert(ca1)).not.toThrow();
    expect(() => ctx.context.addCACert(ca1)).not.toThrow();
  });

  it("accepts a multi-cert bundle in a single call", async () => {
    // Bundle two CAs; only ca1 is needed for the handshake — this asserts
    // the PEM reader walks past the first END CERTIFICATE and picks up the
    // second. Order doesn't matter to the reader.
    const bundle = ca2 + "\n" + ca1;
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    await using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: agent1Cert, key: agent1Key },
      socket: {
        data() {},
        error() {},
        open(s) {
          s.end();
        },
      },
    });

    const ctx = tls.createSecureContext();
    ctx.context.addCACert(bundle);

    const client = tls.connect(
      {
        port: server.port,
        host: "127.0.0.1",
        secureContext: ctx,
        rejectUnauthorized: false,
        servername: "agent1",
      },
      () => {
        resolve(client.authorized);
        client.end();
      },
    );
    client.on("error", reject);

    expect(await promise).toBe(true);
  });

  it("preserves OS/default trust anchors", async () => {
    // After addCACert, connecting to a host signed by a public CA must still
    // work — we should ADD to the default trust store, not REPLACE it.
    const ctx = tls.createSecureContext();
    ctx.context.addCACert(ca2); // unrelated private CA

    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    const client = tls.connect(
      {
        port: 443,
        host: "bun.sh",
        secureContext: ctx,
        rejectUnauthorized: true,
        servername: "bun.sh",
      },
      () => {
        resolve(client.authorized);
        client.end();
      },
    );
    client.on("error", reject);

    expect(await promise).toBe(true);
  });

  it("requires at least one argument", () => {
    const ctx = tls.createSecureContext();
    // @ts-expect-error — intentionally calling with no args
    expect(() => ctx.context.addCACert()).toThrow();
  });
});
