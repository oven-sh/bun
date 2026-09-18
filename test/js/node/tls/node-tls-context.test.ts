// This test ensures that when a TLS connection is established, the server
// selects the most recently added SecureContext that matches the servername.

import { describe, expect, it } from "bun:test";

import { bunEnv, bunExe, tempDir } from "harness";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net, { AddressInfo } from "node:net";
import { join } from "node:path";
import { duplexPair } from "node:stream";
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

// BoringSSL runs its ALPN selection callback after it picked the certificate,
// and on TLS 1.2 after it picked the session too. ALPNCallback has to run
// before both, or the context it selects with setKeyCert() serves neither its
// certificate nor its own client-certificate verdict: a resumed handshake
// skips client authentication and reports the verdict saved in the session.
describe.each([
  ["TLSv1.2", "TLSv1.2"],
  ["TLSv1.3 by default", undefined],
] as const)("ALPNCallback selecting a context (%s)", (_label, maxVersion) => {
  const version = maxVersion ?? "TLSv1.3";
  // ca1 issued agent1 and ca2 issued agent3. agent2 is self-signed.
  const clients = {
    agent1: { key: agent1Key, cert: agent1Cert },
    agent3: { key: agent3Key, cert: agent3Cert },
  };
  const trustedBy = { agent1: "a", agent3: "b" } as const;
  const servedFor = { a: "agent2", b: "agent3" } as const;

  type Seen = {
    version: string | null;
    alpn: string | false;
    authorized: boolean;
    error: string | null;
    peer: string | null;
    resumed: boolean;
  };

  // The default context trusts ca1. ALPN protocol "b" selects one that trusts ca2.
  function createAlpnServer(options: tls.TlsOptions = {}, calls: string[] = []) {
    const contextB = tls.createSecureContext({ key: agent3Key, cert: agent3Cert, ca: [ca2] });
    return tls.createServer({
      key: agent2Key,
      cert: agent2Cert,
      ca: [ca1],
      requestCert: true,
      maxVersion,
      ALPNCallback(this: tls.TLSSocket, { servername, protocols }: { servername: string; protocols: string[] }) {
        calls.push(`alpn:${servername}:${protocols}:${this.getProtocol()}`);
        if (protocols[0] === "b") this.setKeyCert(contextB);
        return protocols[0];
      },
      ...options,
    });
  }

  function report(socket: tls.TLSSocket) {
    const seen: Seen = {
      version: socket.getProtocol(),
      alpn: socket.alpnProtocol as string | false,
      authorized: socket.authorized,
      error: (socket.authorizationError as unknown as string | undefined) ?? null,
      peer: socket.getPeerCertificate()?.subject?.CN ?? null,
      resumed: socket.isSessionReused(),
    };
    socket.on("error", () => {});
    socket.end(JSON.stringify(seen));
  }

  // How a client reaches `server`. "listener" and "adopted" run the TLS engine
  // in usockets, "duplex" in the SSLWrapper.
  type Transport = Disposable & { open(options: tls.ConnectionOptions): tls.TLSSocket };
  const transports = {
    async listener(server: tls.Server): Promise<Transport> {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as AddressInfo;
      return { open: options => tls.connect({ host: "127.0.0.1", port, ...options }), [Symbol.dispose]() {} };
    },
    async adopted(server: tls.Server): Promise<Transport> {
      const raw = net.createServer(socket => server.emit("connection", socket));
      await once(raw.listen(0, "127.0.0.1"), "listening");
      const { port } = raw.address() as AddressInfo;
      return {
        open: options => tls.connect({ host: "127.0.0.1", port, ...options }),
        [Symbol.dispose]: () => void raw.close(),
      };
    },
    async duplex(server: tls.Server): Promise<Transport> {
      return {
        open: options => {
          const [clientSide, serverSide] = duplexPair();
          server.emit("connection", serverSide);
          return tls.connect({ socket: clientSide, ...options });
        },
        [Symbol.dispose]() {},
      };
    },
  };

  // Resolves to the certificate the server presented, to what the server
  // reported, and to the session for a later connection.
  function exchange(socket: tls.TLSSocket) {
    const { promise, resolve, reject } = Promise.withResolvers<{
      served: string | null;
      seen: Seen;
      session: Buffer | undefined;
    }>();
    let served: string | null = null;
    let body = "";
    let session: Buffer | undefined;
    socket.on("secureConnect", () => (served = socket.getPeerCertificate()?.subject?.CN ?? null));
    socket.on("session", s => (session = s));
    socket.on("data", chunk => (body += chunk));
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("closed before the server ended the stream")));
    socket.on("end", () => {
      socket.destroy();
      try {
        resolve({ served, seen: JSON.parse(body), session });
      } catch (e) {
        reject(e);
      }
    });
    return promise;
  }

  // A full handshake with each protocol, then each of the two sessions offered
  // with each protocol.
  async function connections(transport: Transport, name: keyof typeof clients) {
    const offer = (alpn: string, session?: Buffer) =>
      exchange(transport.open({ ...clients[name], rejectUnauthorized: false, ALPNProtocols: [alpn], session }));
    const fullA = await offer("a");
    const fullB = await offer("b");
    const offers: { served: string | null; seen: Seen }[] = [];
    for (const session of [fullA.session, fullB.session]) {
      for (const alpn of ["a", "b"]) {
        const { served, seen } = await offer(alpn, session);
        offers.push({ served, seen });
      }
    }
    return {
      full: [fullA, fullB].map(({ served, seen }) => ({ served, seen })),
      gotSessions: [Buffer.isBuffer(fullA.session), Buffer.isBuffer(fullB.session)],
      offers,
    };
  }

  // The selected context serves its certificate and judges the client. A
  // session resumes only under the context that created it.
  function expectedConnections(name: keyof typeof clients) {
    const connection = (alpn: "a" | "b", resumed: boolean) => ({
      served: servedFor[alpn],
      seen:
        trustedBy[name] === alpn
          ? { version, alpn, authorized: true, error: null, peer: name, resumed }
          : { version, alpn, authorized: false, error: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", peer: name, resumed },
    });
    return {
      full: [connection("a", false), connection("b", false)],
      gotSessions: [true, true],
      offers: [connection("a", true), connection("b", false), connection("a", false), connection("b", true)],
    };
  }

  describe.each(["listener", "adopted", "duplex"] as const)("over a %s transport", kind => {
    it.each(["agent1", "agent3"] as const)("serves and verifies %s under the selected context", async name => {
      const server = createAlpnServer({ rejectUnauthorized: false });
      server.on("secureConnection", report);
      try {
        using transport = await transports[kind](server);
        expect(await connections(transport, name)).toEqual(expectedConnections(name));
      } finally {
        server.close();
      }
    });
  });

  describe.each(["listener", "duplex"] as const)("over a %s transport", kind => {
    // The default `rejectUnauthorized` is how an mTLS server is configured:
    // the client the selected context refuses must not reach the handler.
    it("keeps a refused client out of the handler with the default rejectUnauthorized", async () => {
      const server = createAlpnServer();
      const handled: string[] = [];
      const refused: (string | undefined)[] = [];
      let settle = () => {};
      server.on("secureConnection", socket => {
        handled.push(`${socket.alpnProtocol}:${socket.authorized}:${socket.isSessionReused()}`);
        report(socket);
        settle();
      });
      server.on("tlsClientError", (err: Error & { code?: string }) => {
        refused.push(err.code);
        settle();
      });
      try {
        using transport = await transports[kind](server);
        const first = await exchange(
          transport.open({ ...clients.agent1, rejectUnauthorized: false, ALPNProtocols: ["a"] }),
        );
        expect(Buffer.isBuffer(first.session)).toBe(true);

        const settled = Promise.withResolvers<void>();
        settle = settled.resolve;
        const second = transport.open({
          ...clients.agent1,
          rejectUnauthorized: false,
          ALPNProtocols: ["b"],
          session: first.session,
        });
        second.on("error", () => {});
        await settled.promise;
        second.destroy();

        expect({ handled, refused }).toEqual({
          handled: ["a:true:false"],
          refused: ["UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
        });
      } finally {
        server.close();
      }
    });

    // BoringSSL reads its ALPN selection callback, which sends the refusal's
    // alert, off the SSL_CTX that setKeyCert() installed.
    it("refuses the connection when ALPNCallback throws after setKeyCert()", async () => {
      const contextB = tls.createSecureContext({ key: agent3Key, cert: agent3Cert, ca: [ca2] });
      const server = tls.createServer({
        key: agent2Key,
        cert: agent2Cert,
        maxVersion,
        ALPNCallback(this: tls.TLSSocket) {
          this.setKeyCert(contextB);
          throw new Error("refused after setKeyCert()");
        },
      });
      const events: string[] = [];
      const settled = Promise.withResolvers<void>();
      server.on("secureConnection", () => {
        events.push("secureConnection");
        settled.resolve();
      });
      server.on("tlsClientError", err => {
        events.push(`tlsClientError: ${err.message}`);
        settled.resolve();
      });
      try {
        using transport = await transports[kind](server);
        const client = transport.open({ rejectUnauthorized: false, ALPNProtocols: ["a"] });
        // The alert, or a disconnect: either way the handshake failed.
        client.on("error", () => {});
        await settled.promise;
        client.destroy();
        expect(events).toEqual(["tlsClientError: refused after setKeyCert()"]);
      } finally {
        server.close();
      }
    });
  });

  // What the agent1 client sees and is told for each protocol at `servername`.
  async function bothProtocols(server: tls.Server, servername?: string) {
    using transport = await transports.listener(server);
    const results: { served: string | null; alpn: string | false; authorized: boolean }[] = [];
    for (const alpn of ["a", "b"]) {
      const { served, seen } = await exchange(
        transport.open({ ...clients.agent1, rejectUnauthorized: false, ALPNProtocols: [alpn], servername }),
      );
      results.push({ served, alpn: seen.alpn, authorized: seen.authorized });
    }
    return results;
  }
  // agent1 is the certificate of the context the server name selects.
  const afterServerName = [
    { served: "agent1", alpn: "a", authorized: true },
    { served: "agent3", alpn: "b", authorized: false },
  ];

  it.each(["a synchronous", "an asynchronous"] as const)("runs after %s SNICallback", async kind => {
    const calls: string[] = [];
    const sniContext = tls.createSecureContext({ key: agent1Key, cert: agent1Cert, ca: [ca1] });
    const server = createAlpnServer(
      {
        rejectUnauthorized: false,
        SNICallback(servername, callback) {
          calls.push(`sni:${servername}`);
          if (kind === "a synchronous") callback(null, sniContext);
          else setImmediate(callback, null, sniContext);
        },
      },
      calls,
    );
    server.on("secureConnection", report);
    try {
      expect(await bothProtocols(server, "sni.test")).toEqual(afterServerName);
      // Like in Node, the callback already sees the negotiated version.
      expect(calls).toEqual([
        "sni:sni.test",
        `alpn:sni.test:a:${version}`,
        "sni:sni.test",
        `alpn:sni.test:b:${version}`,
      ]);
    } finally {
      server.close();
    }
  });

  it("runs after an addContext() entry matched", async () => {
    const server = createAlpnServer({ rejectUnauthorized: false });
    server.addContext("tree.test", { key: agent1Key, cert: agent1Cert, ca: [ca1] });
    server.on("secureConnection", report);
    try {
      expect(await bothProtocols(server, "tree.test")).toEqual(afterServerName);
    } finally {
      server.close();
    }
  });

  // Bun hands the TLSSocket to 'connection', before the ClientHello arrives.
  it("still runs when setKeyCert() replaced the context before the handshake", async () => {
    const calls: string[] = [];
    const contextB = tls.createSecureContext({ key: agent3Key, cert: agent3Cert, ca: [ca2] });
    const server = createAlpnServer({ rejectUnauthorized: false }, calls);
    server.on("connection", socket => (socket as tls.TLSSocket).setKeyCert(contextB));
    server.on("secureConnection", report);
    try {
      expect(await bothProtocols(server)).toEqual([
        { served: "agent3", alpn: "a", authorized: false },
        { served: "agent3", alpn: "b", authorized: false },
      ]);
      expect(calls).toEqual([`alpn:undefined:a:${version}`, `alpn:undefined:b:${version}`]);
    } finally {
      server.close();
    }
  });

  // addCACert() changes whom a context trusts, not the options it was built from.
  it("does not resume a session under a context that differs only by addCACert()", async () => {
    const trustsCa2 = tls.createSecureContext({ key: agent3Key, cert: agent3Cert });
    trustsCa2.context.addCACert(ca2);
    const trustsCa1 = tls.createSecureContext({ key: agent3Key, cert: agent3Cert });
    trustsCa1.context.addCACert(ca1);
    const server = createAlpnServer({
      rejectUnauthorized: false,
      ALPNCallback(this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
        this.setKeyCert(protocols[0] === "b" ? trustsCa2 : trustsCa1);
        return protocols[0];
      },
    });
    server.on("secureConnection", report);
    try {
      using transport = await transports.listener(server);
      const offer = (alpn: string, session?: Buffer) =>
        exchange(transport.open({ ...clients.agent3, rejectUnauthorized: false, ALPNProtocols: [alpn], session }));
      const atB = await offer("b");
      const atC = await offer("c", atB.session);
      expect([atB.seen, atC.seen]).toEqual([
        { version, alpn: "b", authorized: true, error: null, peer: "agent3", resumed: false },
        {
          version,
          alpn: "c",
          authorized: false,
          error: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          peer: "agent3",
          resumed: false,
        },
      ]);
    } finally {
      server.close();
    }
  });

  // The session id context is for servers: a client whose id differs from
  // its session's fails the resumed handshake.
  it("lets a client that calls setKeyCert() still resume", async () => {
    const server = tls.createServer({ key: agent2Key, cert: agent2Cert, maxVersion }, report);
    const clientContext = tls.createSecureContext(clients.agent1);
    try {
      using transport = await transports.listener(server);
      const first = await exchange(transport.open({ rejectUnauthorized: false }));
      const socket = transport.open({ rejectUnauthorized: false, session: first.session });
      socket.on("connect", () => socket.setKeyCert(clientContext));
      const second = await exchange(socket);
      expect([first.seen.resumed, second.seen.resumed]).toEqual([false, true]);
    } finally {
      server.close();
    }
  });

  it("does not run for a handshake that fails before the certificate is selected", async () => {
    const calls: string[] = [];
    // The client and the server share no protocol version.
    const server = createAlpnServer(maxVersion ? {} : { minVersion: "TLSv1.3" }, calls);
    const events: string[] = [];
    const settled = Promise.withResolvers<void>();
    server.on("secureConnection", () => {
      events.push("secureConnection");
      settled.resolve();
    });
    server.on("tlsClientError", (err: Error & { code?: string }) => {
      events.push(`tlsClientError: ${err.code}`);
      settled.resolve();
    });
    try {
      using transport = await transports.listener(server);
      const client = transport.open({
        rejectUnauthorized: false,
        ALPNProtocols: ["a"],
        ...(maxVersion ? { minVersion: "TLSv1.3" } : { maxVersion: "TLSv1.2" }),
      });
      client.on("error", () => {});
      await settled.promise;
      client.destroy();
      expect({ calls, events }).toEqual({ calls: [], events: ["tlsClientError: ERR_SSL_UNSUPPORTED_PROTOCOL"] });
    } finally {
      server.close();
    }
  });
});

describe("ALPNCallback", () => {
  // Replays a ClientHello of a real client with the body of its ALPN
  // extension replaced, and every enclosing length corrected.
  async function clientHelloWithAlpn(body: Buffer) {
    const captured = Promise.withResolvers<Buffer>();
    const sink = net.createServer(socket => {
      let received = Buffer.alloc(0);
      socket.on("error", captured.reject);
      socket.on("data", chunk => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= 5 && received.length >= 5 + received.readUInt16BE(3)) {
          captured.resolve(received.subarray(0, 5 + received.readUInt16BE(3)));
        }
      });
    });
    await once(sink.listen(0, "127.0.0.1"), "listening");
    const client = tls.connect({
      host: "127.0.0.1",
      port: (sink.address() as AddressInfo).port,
      rejectUnauthorized: false,
      ALPNProtocols: ["ab"],
    });
    client.on("error", () => {});
    let hello: Buffer;
    try {
      hello = await captured.promise;
    } finally {
      client.destroy();
      sink.close();
    }

    let at = 5 + 4 + 2 + 32; // record header, handshake header, version, random
    at += 1 + hello[at]; // session id
    at += 2 + hello.readUInt16BE(at); // cipher suites
    at += 1 + hello[at]; // compression methods
    const extensionsAt = at;
    const extensions: Buffer[] = [];
    let replaced = false;
    for (at += 2; at < hello.length; ) {
      const type = hello.readUInt16BE(at);
      const data = hello.subarray(at + 4, at + 4 + hello.readUInt16BE(at + 2));
      at += 4 + data.length;
      const isAlpn = type === 16;
      replaced ||= isAlpn;
      const header = Buffer.alloc(4);
      header.writeUInt16BE(type, 0);
      header.writeUInt16BE((isAlpn ? body : data).length, 2);
      extensions.push(header, isAlpn ? body : data);
    }
    if (!replaced) throw new Error("the captured ClientHello has no ALPN extension");
    const encoded = Buffer.concat(extensions);
    const out = Buffer.concat([hello.subarray(0, extensionsAt + 2), encoded]);
    out.writeUInt16BE(encoded.length, extensionsAt);
    out.writeUInt16BE(out.length - 5, 3); // record length
    out.writeUIntBE(out.length - 9, 6, 3); // handshake length
    return out;
  }

  it.each([
    ["the list a real client sends", [0, 3, 2, 0x61, 0x62], { calls: [["ab"]], error: null }],
    ["an empty list", [0, 0], { calls: [], error: "ERR_SSL_PARSE_TLSEXT" }],
    ["an empty protocol name", [0, 3, 0, 1, 0x62], { calls: [], error: "ERR_SSL_PARSE_TLSEXT" }],
    ["a protocol name longer than the list", [0, 3, 3, 0x61, 0x62], { calls: [], error: "ERR_SSL_PARSE_TLSEXT" }],
    ["a byte after the list", [0, 3, 2, 0x61, 0x62, 0], { calls: [], error: "ERR_SSL_PARSE_TLSEXT" }],
  ] as const)("runs for %s only when the list is well formed", async (_name, body, expected) => {
    const calls: string[][] = [];
    let error: string | null = null;
    const settled = Promise.withResolvers<void>();
    const server = tls.createServer({
      key: agent2Key,
      cert: agent2Cert,
      ALPNCallback({ protocols }) {
        calls.push(protocols);
        settled.resolve();
        return protocols[0];
      },
    });
    server.on("tlsClientError", (err: Error & { code?: string }) => {
      error ??= err.code ?? err.message;
      settled.resolve();
    });
    const hello = await clientHelloWithAlpn(Buffer.from(body));
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const raw = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
      raw.on("error", () => {});
      raw.write(hello);
      await settled.promise;
      raw.destroy();
      expect({ calls, error }).toEqual(expected);
    } finally {
      server.close();
    }
  });
});

it("accepts every BoringSSL named group (and alias) as ecdhCurve", () => {
  // Mirrors vendor/boringssl/ssl/ssl_key_share.cc kNamedGroups at the pinned
  // commit. This pins the set the public API accepts; it cannot detect a NEW
  // upstream group by itself - the boringssl upgrade doc re-derives the list.
  const groups = [
    "P-256",
    "prime256v1",
    "P-384",
    "secp384r1",
    "P-521",
    "secp521r1",
    "X25519",
    "x25519",
    "X25519MLKEM768",
    "MLKEM1024",
  ];
  const rejected = groups.filter(g => {
    try {
      tls.createSecureContext({ ecdhCurve: g });
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toEqual([]);
  // "auto" and a colon-separated list are accepted like Node.
  expect(() => tls.createSecureContext({ ecdhCurve: "auto" })).not.toThrow();
  expect(() => tls.createSecureContext({ ecdhCurve: "P-256:X25519" })).not.toThrow();
});

it("rejects an unsupported ecdhCurve with Node's error shape", () => {
  // Node: THROW_ERR_CRYPTO_OPERATION_FAILED sets `code` without renaming the
  // error, so String(err) still matches the upstream tests' /Error: .../ regex:
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1973-L1975
  let err: any;
  try {
    tls.createSecureContext({ ecdhCurve: "not-a-real-curve" });
  } catch (e) {
    err = e;
  }
  expect({ name: err?.name, code: err?.code, message: err?.message, text: String(err) }).toEqual({
    name: "Error",
    code: "ERR_CRYPTO_OPERATION_FAILED",
    message: "Failed to set ECDH curve",
    text: "Error: Failed to set ECDH curve",
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
