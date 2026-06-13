// This test ensures that when a TLS connection is established, the server
// selects the most recently added SecureContext that matches the servername.

import { describe, expect, it } from "bun:test";
// @ts-expect-error — debug-only export
import { secureContextVerifyMode } from "bun:internal-for-testing";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

import { readFileSync } from "node:fs";
import net, { AddressInfo } from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
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

  it("accepts createSecureContext(null) (Node parity)", () => {
    // Node treats `undefined` / `null` as an empty dictionary. Bindgen's
    // converter throws ERR_INVALID_ARG_TYPE on non-objects, so the
    // constructor/intern paths (Rust `SecureContext.rs`) short-circuit on
    // `is_undefined_or_null()` before reaching it. The sibling "is a function"
    // test above covers the no-arg form; this one covers explicit `null`.
    const ctx = tls.createSecureContext(null);
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

  it("silently ignores empty / malformed PEM input (Node parity)", () => {
    // Within the documented input surface (string / Buffer / TypedArray /
    // ArrayBuffer), Node's addCACert is lenient about byte content — an
    // empty or malformed blob is a no-op, not a throw. Invalid JS types
    // (null/undefined/number/plain object) are NOT part of the contract;
    // their behavior is intentionally unspecified and tested elsewhere.
    const ctx = tls.createSecureContext();
    expect(() => ctx.context.addCACert("")).not.toThrow();
    expect(() => ctx.context.addCACert("not pem")).not.toThrow();
    expect(() => ctx.context.addCACert(Buffer.alloc(0))).not.toThrow();
    expect(() => ctx.context.addCACert(new Uint8Array())).not.toThrow();
    expect(() => ctx.context.addCACert(new ArrayBuffer(0))).not.toThrow();
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

  it("preserves default trust anchors (addCACert adds, not replaces)", async () => {
    // Deterministic version of "trust the internet after addCACert": run a
    // child bun with NODE_EXTRA_CA_CERTS=ca1 so ca1 is baked into the default
    // trust store, then call addCACert(ca2) on a fresh SecureContext. If the
    // first call REPLACED the store with a fresh one, ca1 would be gone and
    // the agent1 handshake would fail; the assertion is that it still
    // succeeds. Uses a child process so the env var is read at startup.
    const dir = tempDirWithFiles("tls-addcacert-preserve", {
      "ca1.pem": ca1,
      "ca2.pem": ca2,
      "agent1-cert.pem": agent1Cert,
      "agent1-key.pem": agent1Key,
      "check.js": /* js */ `
        const tls = require("node:tls");
        const fs = require("node:fs");
        const path = require("node:path");
        const server = tls.createServer(
          {
            cert: fs.readFileSync(path.join(__dirname, "agent1-cert.pem")),
            key: fs.readFileSync(path.join(__dirname, "agent1-key.pem")),
          },
          s => s.end(),
        );
        server.listen(0, () => {
          const port = server.address().port;
          const ctx = tls.createSecureContext();
          // Mutating: if we replaced the default store, NODE_EXTRA_CA_CERTS's
          // ca1 contribution disappears and the handshake below fails.
          ctx.context.addCACert(fs.readFileSync(path.join(__dirname, "ca2.pem")));
          const client = tls.connect(
            { port, host: "127.0.0.1", secureContext: ctx, servername: "agent1", rejectUnauthorized: false },
            () => {
              console.log(JSON.stringify({ authorized: client.authorized, error: client.authorizationError ?? null }));
              client.end();
              server.close();
            },
          );
          client.on("error", e => {
            console.log(JSON.stringify({ authorized: false, error: String(e) }));
            server.close();
          });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.js"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(dir, "ca1.pem") },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.authorized).toBe(true);
    expect(exitCode).toBe(0);
  });

  it("requires at least one argument", () => {
    const ctx = tls.createSecureContext();
    // @ts-expect-error — intentionally calling with no args
    expect(() => ctx.context.addCACert()).toThrow();
  });

  // SecureContext is mode-neutral — the same object may back both a client
  // AND a server. `addCACert` must NOT flip CTX-level verify_mode; if it did,
  // a server built from this context would start sending `CertificateRequest`
  // in every handshake (e.g. browsers would prompt for a client certificate).
  // Node's `SecureContext::AddCACert` never touches verify_mode for exactly
  // this reason.
  it("does not flip CTX verify_mode (would leak as server requestCert)", () => {
    // Baseline: a fresh SecureContext has SSL_VERIFY_NONE (= 0).
    const ctx = tls.createSecureContext({ cert: agent1Cert, key: agent1Key });
    expect(secureContextVerifyMode(ctx.context)).toBe(0);

    // After addCACert, verify_mode must STILL be SSL_VERIFY_NONE. If it
    // wasn't, a server built from this context would start sending
    // CertificateRequest even when the user never set `requestCert`.
    ctx.context.addCACert(ca1);
    expect(secureContextVerifyMode(ctx.context)).toBe(0);

    // For completeness: the `options.ca` construction path still flips
    // verify_mode (pre-existing quirk we're not changing), so this is the
    // strict stronger guarantee for the post-construction API only.
  });

  // Regression found in review: the first addCACert() on a context built
  // with `options.ca` must append to — not replace — the construction-time
  // trust store. If we swap in a fresh `us_get_default_ca_store()` on the
  // first call, the CAs passed to `createSecureContext({ca: ...})` are
  // silently dropped, breaking `{ca: corpRoot}.addCACert(extraCA)`.
  it("preserves construction-time CAs on the first addCACert call", async () => {
    // Build with ca1 at construction time; then add the unrelated ca2 on top.
    // agent1 (signed by ca1) must still verify afterwards.
    const ctx = tls.createSecureContext({ ca: ca1 });
    ctx.context.addCACert(ca2);

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

  // `tls.connect({ socket: duplex })` routes through `SSLWrapper` (the Rust
  // `ssl_wrapper` module in `src/uws/lib.rs`) instead of `us_internal_ssl_attach`.
  // That path had the same per-SSL `SSL_set0_verify_cert_store` override and
  // needs the same `us_ctx_has_user_ca` gate, or addCACert'd CAs are
  // discarded when TLS runs on top of a Duplex (Bun.TCPSocket-over-Duplex,
  // node:tls proxies, Windows named pipes).
  it("added CA survives on the Duplex-wrapped client path", async () => {
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

    const rawSocket = net.connect(server.port, "127.0.0.1");
    const duplex = new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        rawSocket.write(chunk, cb);
      },
      final(cb) {
        rawSocket.end(cb);
      },
    });
    rawSocket.on("data", c => duplex.push(c));
    rawSocket.on("end", () => duplex.push(null));
    rawSocket.on("error", e => duplex.destroy(e));

    const ctx = tls.createSecureContext();
    ctx.context.addCACert(ca1);

    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    const client = tls.connect(
      {
        socket: duplex,
        host: "127.0.0.1",
        servername: "agent1",
        secureContext: ctx,
        rejectUnauthorized: false,
      },
      () => {
        resolve(client.authorized);
        client.end();
      },
    );
    client.on("error", reject);

    expect(await promise).toBe(true);
  });
});
