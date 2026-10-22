// This test ensures that when a TLS connection is established, the server
// selects the most recently added SecureContext that matches the servername.

import { describe, expect, it } from "bun:test";

import { bunEnv, bunExe, tempDir } from "harness";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import net, { AddressInfo } from "node:net";
import { join } from "node:path";
import { Duplex, duplexPair } from "node:stream";
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

  // server.close() keeps the connections it already accepted. One that starts
  // its handshake afterwards still selects its context by server name.
  describe.each(["addContext", "SNICallback"] as const)("a handshake that starts after close() resolves %s", mode => {
    it("like one that starts before it", async () => {
      // agent1 chains to ca1, the client's agent3 to ca2: the default context
      // authorizes the client, the a.example.com context does not.
      const tenant = { key: agent1Key, cert: agent1Cert, ca: [ca1] };
      const names: string[] = [];
      const server = tls.createServer(
        {
          key: agent2Key,
          cert: agent2Cert,
          ca: [ca2],
          requestCert: true,
          rejectUnauthorized: false,
          SNICallback:
            mode === "SNICallback"
              ? (name, cb) => {
                  names.push(name);
                  if (name === "a.example.com") cb(null, tls.createSecureContext(tenant));
                  else cb(new Error("unknown tenant"));
                }
              : undefined,
        },
        socket => {
          socket.on("error", () => {});
          //@ts-ignore
          socket.end(`${socket.servername} authorized=${socket.authorized}`);
        },
      );
      server.on("tlsClientError", () => {});
      if (mode === "addContext") server.addContext("a.example.com", tenant);

      const servernames = ["a.example.com", "a.example.com", "a.example.com", "unknown.example.com"];
      let accepted = 0;
      const allAccepted = Promise.withResolvers<void>();
      server.on("connection", () => {
        if (++accepted === servernames.length) allAccepted.resolve();
      });
      server.on("error", allAccepted.reject);
      const raws: net.Socket[] = [];
      try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as AddressInfo).port;
        for (const _ of servernames) raws.push(net.connect({ host: "127.0.0.1", port }));
        for (const raw of raws) raw.on("error", () => {});
        await Promise.all(raws.map(raw => once(raw, "connect")));
        await allAccepted.promise;

        // No TLS byte has been sent yet.
        server.close();

        const outcomes = await Promise.all(
          raws.map((raw, i) => {
            const { promise, resolve } = Promise.withResolvers<{ certificate: string; received: string }>();
            let certificate = "no handshake";
            let received = "";
            const socket = tls.connect(
              { socket: raw, servername: servernames[i], rejectUnauthorized: false, key: agent3Key, cert: agent3Cert },
              () => (certificate = socket.getPeerCertificate().subject.CN as string),
            );
            socket.on("data", chunk => (received += chunk));
            socket.on("error", () => {});
            socket.on("close", () => resolve({ certificate, received }));
            return promise;
          }),
        );

        const tenantOutcome = { certificate: "agent1", received: "a.example.com authorized=false" };
        expect(outcomes.slice(0, 3)).toEqual([tenantOutcome, tenantOutcome, tenantOutcome]);
        if (mode === "SNICallback") {
          // The callback is the allow-list: a name it rejects gets no session.
          expect(outcomes[3]).toEqual({ certificate: "no handshake", received: "" });
          expect(names.toSorted()).toEqual(servernames.toSorted());
        } else {
          expect(outcomes[3].certificate).toBe("agent2");
        }
      } finally {
        if (server.listening) server.close();
        for (const raw of raws) raw.destroy();
      }
    });
  });
});

// A resumed handshake skips client authentication, so the server may only
// resume a session under a context configured like the one that verified the
// client certificate. The refusal below is deliberate and must not be relaxed
// for parity with another runtime: RFC 6066 section 3 lets a server resume only
// a session established for the requested name, and BoringSSL tells servers to
// partition sessions between SNI hosts this way
// (vendor/boringssl/include/openssl/ssl.h:2199-2207).
describe.each(["TLSv1.3", "TLSv1.2"] as const)("session resumption across SNI contexts (%s)", maxVersion => {
  type Seen = {
    servername: string;
    authorized: boolean;
    error: string | null;
    peer: string | null;
    resumed: boolean;
  };

  // The default context trusts ca1 for client certificates.
  async function listen(options: tls.TlsOptions = {}) {
    const server = tls.createServer(
      {
        key: agent2Key,
        cert: agent2Cert,
        ca: [ca1],
        requestCert: true,
        rejectUnauthorized: false,
        maxVersion,
        ...options,
      },
      socket => {
        socket.on("error", () => {});
        const seen: Seen = {
          //@ts-ignore
          servername: socket.servername,
          authorized: socket.authorized,
          //@ts-ignore
          error: socket.authorizationError ?? null,
          peer: (socket.getPeerCertificate()?.subject?.CN as string) ?? null,
          resumed: socket.isSessionReused(),
        };
        socket.end(JSON.stringify(seen));
      },
    );
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
    await promise;
    return server;
  }

  // Connects with the client certificate ca1 issued. Resolves to what the
  // server saw, and the session the client got for a later connection.
  function connect(
    server: tls.Server,
    servername: string,
    options: tls.ConnectionOptions = {},
    onSocket?: (socket: tls.TLSSocket) => void,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<{ seen: Seen; session: Buffer }>();
    let body = "";
    let session: Buffer | undefined;
    const socket = tls.connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      servername,
      key: agent1Key,
      cert: agent1Cert,
      rejectUnauthorized: false,
      ...options,
    });
    onSocket?.(socket);
    socket.on("session", s => (session = s));
    socket.on("data", chunk => (body += chunk));
    socket.on("error", reject);
    socket.on("close", () => {
      try {
        resolve({ seen: JSON.parse(body), session: session! });
      } catch (e) {
        reject(e);
      }
    });
    return promise;
  }

  const accepted = (servername: string): Seen => ({
    servername,
    authorized: true,
    error: null,
    peer: "agent1",
    resumed: false,
  });
  const refused = (servername: string): Seen => ({
    servername,
    authorized: false,
    error: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    peer: "agent1",
    resumed: false,
  });

  it("runs a full handshake under a context that trusts another CA", async () => {
    const server = await listen();
    try {
      server.addContext("a.test", { key: agent1Key, cert: agent1Cert, ca: [ca1] });
      server.addContext("b.test", { key: agent3Key, cert: agent3Cert, ca: [ca2] });

      const atDefault = await connect(server, "default.test");
      const atA = await connect(server, "a.test");
      const atB = await connect(server, "b.test");
      expect([atDefault.seen, atA.seen, atB.seen]).toEqual([
        accepted("default.test"),
        accepted("a.test"),
        refused("b.test"),
      ]);

      // b.test verifies the certificate again, against ca2, whichever
      // context's session the client offers.
      const fromDefault = await connect(server, "b.test", { session: atDefault.session });
      const fromA = await connect(server, "b.test", { session: atA.session });
      expect([fromDefault.seen, fromA.seen]).toEqual([refused("b.test"), refused("b.test")]);

      // Every context still resumes its own sessions.
      const again = [
        await connect(server, "default.test", { session: atDefault.session }),
        await connect(server, "a.test", { session: atA.session }),
        await connect(server, "b.test", { session: atB.session }),
      ];
      expect(again.map(c => c.seen)).toEqual([
        { ...accepted("default.test"), resumed: true },
        { ...accepted("a.test"), resumed: true },
        { ...refused("b.test"), resumed: true },
      ]);
    } finally {
      server.close();
    }
  });

  // The same door with the default `rejectUnauthorized`, which is how an mTLS
  // server is configured: the refused client must not reach the handler at all.
  it("keeps a refused client out of the handler with the default rejectUnauthorized", async () => {
    const handled: string[] = [];
    const server = tls.createServer(
      { key: agent2Key, cert: agent2Cert, ca: [ca1], requestCert: true, maxVersion },
      socket => {
        socket.on("error", () => {});
        //@ts-ignore
        handled.push(`${socket.servername}:${socket.authorized}:${socket.isSessionReused()}`);
        socket.end("{}");
      },
    );
    server.on("tlsClientError", () => {});
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    try {
      server.addContext("a.test", { key: agent1Key, cert: agent1Cert, ca: [ca1] });
      server.addContext("b.test", { key: agent3Key, cert: agent3Cert, ca: [ca2] });

      const atA = await connect(server, "a.test").catch(() => ({ session: undefined }));
      await connect(server, "b.test").catch(() => {});
      await connect(server, "b.test", { session: atA.session }).catch(() => {});

      // a.test only. b.test refuses the client before the handler, with or
      // without a.test's session.
      expect(handled).toEqual(["a.test:true:false"]);
    } finally {
      server.close();
    }
  });

  it("covers the contexts an SNICallback builds for each handshake", async () => {
    const contexts = {
      "a.test": { key: agent1Key, cert: agent1Cert, ca: [ca1] },
      "b.test": { key: agent3Key, cert: agent3Cert, ca: [ca2] },
    };
    const server = await listen({
      SNICallback: (servername, callback) => callback(null, tls.createSecureContext(contexts[servername])),
    });
    try {
      const atA = await connect(server, "a.test");
      expect(atA.seen).toEqual(accepted("a.test"));

      const fromA = await connect(server, "b.test", { session: atA.session });
      expect(fromA.seen).toEqual(refused("b.test"));

      // The context for this handshake is a new object built from the same
      // options as the one that issued the session, so the session resumes.
      const again = await connect(server, "a.test", { session: atA.session });
      expect(again.seen).toEqual({ ...accepted("a.test"), resumed: true });
    } finally {
      server.close();
    }
  });

  it("covers contexts that differ only by addCACert", async () => {
    const trusting = (ca: string) => {
      const context = tls.createSecureContext({ key: agent1Key, cert: agent1Cert });
      //@ts-ignore
      context.context.addCACert(ca);
      return context;
    };
    const server = await listen();
    try {
      server.addContext("a.test", trusting(ca1));
      server.addContext("b.test", trusting(ca2));

      const atA = await connect(server, "a.test");
      expect(atA.seen).toEqual(accepted("a.test"));

      const fromA = await connect(server, "b.test", { session: atA.session });
      expect(fromA.seen).toEqual(refused("b.test"));

      const again = await connect(server, "a.test", { session: atA.session });
      expect(again.seen).toEqual({ ...accepted("a.test"), resumed: true });
    } finally {
      server.close();
    }
  });

  // The session id context that separates a server's contexts must not reach
  // client sockets: a client aborts a resumed handshake when the session's id
  // differs from its own.
  it("lets a client offer a session under other client options", async () => {
    const server = await listen();
    try {
      const first = await connect(server, "default.test");
      expect(first.seen).toEqual(accepted("default.test"));

      // `ca` puts these connections on another client context than `first`.
      const overTcp = await connect(server, "default.test", { session: first.session, ca: [ca2] });
      expect(overTcp.seen).toEqual({ ...accepted("default.test"), resumed: true });

      const raw = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
      const duplex = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          raw.write(chunk, encoding, callback);
        },
        final(callback) {
          raw.end();
          callback();
        },
      });
      raw.on("data", chunk => duplex.push(chunk));
      raw.on("end", () => duplex.push(null));
      raw.on("close", () => duplex.destroy());
      const overDuplex = await connect(server, "default.test", {
        session: first.session,
        ca: [ca2],
        socket: duplex,
      });
      expect(overDuplex.seen).toEqual({ ...accepted("default.test"), resumed: true });
    } finally {
      server.close();
    }
  });

  // `setKeyCert()` moves the connection to another context. On a client that
  // must not take the context's session id context either.
  it("lets a client that calls setKeyCert() still resume", async () => {
    const other = tls.createSecureContext({ key: agent3Key, cert: agent3Cert });
    const server = await listen();
    try {
      const first = await connect(server, "default.test");
      expect(first.seen).toEqual(accepted("default.test"));

      const again = await connect(server, "default.test", { session: first.session }, socket =>
        socket.on("connect", () => socket.setKeyCert(other)),
      );
      // A resumed handshake sends no certificate, so the server still reports
      // the one from the full handshake.
      expect(again.seen).toEqual({ ...accepted("default.test"), resumed: true });
    } finally {
      server.close();
    }
  });
});

// Node negotiates ALPN per connection, whichever SecureContext SNI selected.
// https://github.com/oven-sh/bun/issues/17932
describe.each(["TLSv1.2", "TLSv1.3"] as const)("ALPN after SNI selected a SecureContext (%s)", version => {
  const defaults = { key: agent2Key, cert: agent2Cert };
  const selected = { key: agent1Key, cert: agent1Cert };
  type SNICb = (err: Error | null, ctx?: any) => void;
  const sync = (_: string, cb: SNICb) => cb(null, tls.createSecureContext(selected));
  const deferred = (_: string, cb: SNICb) => void setImmediate(cb, null, tls.createSecureContext(selected));

  // How the connection comes by its context. Each returns the port to dial.
  type Start = (alpn: object, onSecure: (socket: tls.TLSSocket) => void, stack: DisposableStack) => Promise<number>;
  const listening = async (server: net.Server, stack: DisposableStack) => {
    stack.defer(() => void server.close());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as AddressInfo).port;
  };
  const accepted =
    (options: object, setup?: (server: tls.Server) => void): Start =>
    (alpn, onSecure, stack) => {
      const server = tls.createServer({ ...defaults, ...options, ...alpn }, onSecure);
      server.on("tlsClientError", () => {});
      setup?.(server);
      return listening(server, stack);
    };
  const addContext = (server: tls.Server) => server.addContext("alpn.sni.test", selected);
  // A server-side TLSSocket over an accepted net.Socket. Its TLS engine starts on the tick after
  // its constructor: `prepare` runs then, before the ClientHello arrives.
  const wrapped =
    (options: object, prepare?: (socket: tls.TLSSocket) => void): Start =>
    (alpn, onSecure, stack) =>
      listening(
        net.createServer(raw => {
          const socket = new tls.TLSSocket(raw, {
            isServer: true,
            secureContext: tls.createSecureContext(defaults),
            ...options,
            ...alpn,
          });
          socket.on("error", () => {});
          socket.on("secure", () => onSecure(socket));
          if (prepare) setImmediate(prepare, socket);
        }),
        stack,
      );
  const paths: [string, Start][] = [
    ["a synchronous SNICallback", accepted({ SNICallback: sync })],
    ["an asynchronous SNICallback", accepted({ SNICallback: deferred })],
    ["addContext()", accepted({}, addContext)],
    // Bun only: in Node a user SNICallback replaces the addContext() entries.
    [
      "addContext() behind an SNICallback that selects nothing",
      accepted({ SNICallback: (_: string, cb: SNICb) => void setImmediate(cb, null, null) }, addContext),
    ],
    [
      "addContext() on an injected socket",
      (alpn, onSecure, stack) => {
        const server = tls.createServer({ ...defaults, ...alpn }, onSecure);
        server.on("tlsClientError", () => {});
        addContext(server);
        return listening(
          net.createServer(raw => server.emit("connection", raw)),
          stack,
        );
      },
    ],
    ["the SNICallback of a server-side TLSSocket", wrapped({ SNICallback: sync })],
    // setKeyCert() replaces the SSL_CTX, and BoringSSL reads the callbacks of the rest of the
    // handshake off the new one.
    [
      "setKeyCert() in the SNICallback of a server-side TLSSocket",
      wrapped({
        SNICallback(this: tls.TLSSocket, _: string, cb: SNICb) {
          this.setKeyCert(tls.createSecureContext(selected));
          cb(null);
        },
      }),
    ],
    [
      "setKeyCert() in an asynchronous SNICallback of a server-side TLSSocket",
      wrapped({
        SNICallback(this: tls.TLSSocket, _: string, cb: SNICb) {
          this.setKeyCert(tls.createSecureContext(selected));
          setImmediate(cb, null);
        },
      }),
    ],
    [
      "setKeyCert() on a server-side TLSSocket before the handshake",
      wrapped({}, socket => socket.setKeyCert(tls.createSecureContext(selected))),
    ],
  ];

  function dial(port: number, ALPNProtocols: string[]) {
    return tls.connect({
      port,
      host: "127.0.0.1",
      servername: "alpn.sni.test",
      ALPNProtocols,
      rejectUnauthorized: false,
      minVersion: version,
      maxVersion: version,
    });
  }

  describe.each(paths)("by %s", (_, start) => {
    it("negotiates from ALPNProtocols", async () => {
      using stack = new DisposableStack();
      const serverSide = Promise.withResolvers<unknown>();
      const port = await start({ ALPNProtocols: ["h2", "http/1.1"] }, s => serverSide.resolve(s.alpnProtocol), stack);
      const client = dial(port, ["http/1.1", "h2"]);
      stack.defer(() => void client.destroy());
      await once(client, "secureConnect");
      expect({
        cn: client.getPeerCertificate().subject.CN,
        client: client.alpnProtocol,
        server: await serverSide.promise,
      }).toEqual({ cn: "agent1", client: "h2", server: "h2" });
    });

    it("runs ALPNCallback", async () => {
      using stack = new DisposableStack();
      const seen: unknown[] = [];
      const ALPNCallback = (offer: unknown) => (seen.push(offer), "h2");
      const client = dial(await start({ ALPNCallback }, s => s.end(), stack), ["http/1.1", "h2"]);
      stack.defer(() => void client.destroy());
      await once(client, "secureConnect");
      expect({ cn: client.getPeerCertificate().subject.CN, client: client.alpnProtocol, seen }).toEqual({
        cn: "agent1",
        client: "h2",
        seen: [{ servername: "alpn.sni.test", protocols: ["http/1.1", "h2"] }],
      });
    });

    // RFC 7301 section 3.2
    it("refuses a client that offers none of ALPNProtocols", async () => {
      using stack = new DisposableStack();
      const client = dial(await start({ ALPNProtocols: ["h2"] }, s => s.end(), stack), ["spdy/3"]);
      stack.defer(() => void client.destroy());
      const outcome = Promise.withResolvers<unknown>();
      client.on("error", err => outcome.resolve((err as NodeJS.ErrnoException).code));
      client.on("secureConnect", () => outcome.resolve(`connected, alpnProtocol=${client.alpnProtocol}`));
      expect(await outcome.promise).toBe("ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL");
    });
  });

  it("http2.createSecureServer() with an SNICallback speaks h2", async () => {
    using stack = new DisposableStack();
    const server = http2.createSecureServer({ ...defaults, SNICallback: sync }, (_, res) => res.end("over h2"));
    const port = await listening(server, stack);
    const session = http2.connect(`https://127.0.0.1:${port}`, {
      servername: "alpn.sni.test",
      rejectUnauthorized: false,
      minVersion: version,
      maxVersion: version,
    });
    stack.defer(() => session.destroy());
    const failed = once(session, "error").then(([err]) => Promise.reject(err));
    const request = session.request({ ":path": "/" }).setEncoding("utf8");
    let body = "";
    request.on("data", chunk => (body += chunk));
    await Promise.race([once(request, "end"), failed]);
    expect(body).toBe("over h2");
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

// Node v26.3.0 compares addContext() names case-sensitively; v26.4.0 and later compile them into /.../i.
describe("SNI matching is case-insensitive", () => {
  function servedCN(port: number, servername: string) {
    const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
    const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false }, () => {
      resolve(socket.getPeerCertificate()?.subject?.CN as string | undefined);
      socket.end();
    });
    socket.on("error", reject);
    return promise;
  }

  it("tls.Server addContext", async () => {
    const server = tls.createServer({ key: agent2Key, cert: agent2Cert }, s => s.end());
    server.addContext("a.example.com", SNIContexts["a.example.com"]); // agent1
    server.addContext("UPPER.EXAMPLE.COM", SNIContexts["asterisk.test.com"]); // agent3
    server.addContext("*.test.com", SNIContexts["asterisk.test.com"]); // agent3
    server.addContext("Twice.example.com", SNIContexts["a.example.com"]); // agent1
    server.addContext("twice.example.com", SNIContexts["asterisk.test.com"]); // agent3
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, listening.resolve);
      await listening.promise;
      const port = (server.address() as AddressInfo).port;
      expect({
        exact: await servedCN(port, "a.example.com"),
        upper: await servedCN(port, "A.EXAMPLE.COM"),
        mixed: await servedCN(port, "A.Example.Com"),
        registeredUpper: await servedCN(port, "upper.example.com"),
        wildcardUpper: await servedCN(port, "B.TEST.COM"),
        lastOfTwoSpellings: await servedCN(port, "Twice.example.com"),
        noMatch: await servedCN(port, "other.example.org"),
      }).toEqual({
        exact: "agent1",
        upper: "agent1",
        mixed: "agent1",
        registeredUpper: "agent3",
        wildcardUpper: "agent3",
        lastOfTwoSpellings: "agent3",
        noMatch: "agent2",
      });
    } finally {
      server.close();
    }
  });

  // The context an SNI selects also decides which CA client certificates must chain to.
  describe.each(["TLSv1.2", "TLSv1.3"] as const)("%s", version => {
    const inAnyCase = ["strict.example.com", "STRICT.EXAMPLE.COM", "sTrIcT.eXaMpLe.CoM"];
    const selectsNothing = (_: string, cb: Function) => cb(null, null);
    it.each([
      ["in any case", inAnyCase, undefined],
      // Bun only: Node serves the default context for a name with the root dot.
      ["with the root dot", ["strict.example.com.", "STRICT.EXAMPLE.COM."], undefined],
      // Bun only: in Node a user SNICallback replaces the addContext() entries.
      ["behind an SNICallback that selects nothing", inAnyCase, selectsNothing],
    ])("a context's client CA applies to its name %s", async (_, spellings, SNICallback) => {
      const server = tls.createServer({
        key: agent2Key,
        cert: agent2Cert,
        ca: [ca1],
        requestCert: true,
        rejectUnauthorized: true,
        SNICallback,
      } as any);
      server.addContext("Strict.Example.com", { key: agent1Key, cert: agent1Cert, ca: [loadPEM("ca5-cert.pem")] });
      // agent1 chains to ca1, which only the default context trusts; ec10 chains to ca5.
      const ec10 = [loadPEM("ec10-key.pem"), loadPEM("ec10-cert.pem")] as const;
      async function verdict(servername: string, key: string, cert: string) {
        const judged = Promise.race([
          once(server, "secureConnection").then(() => "accepted"),
          once(server, "tlsClientError").then(() => "refused"),
        ]);
        const socket = tls.connect({
          host: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          servername,
          key,
          cert,
          rejectUnauthorized: false,
          minVersion: version,
          maxVersion: version,
        });
        socket.on("error", () => {});
        try {
          return await judged;
        } finally {
          socket.destroy();
        }
      }
      try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const verdicts: string[][] = [];
        for (const name of spellings) {
          verdicts.push([name, await verdict(name, agent1Key, agent1Cert), await verdict(name, ...ec10)]);
        }
        expect(verdicts).toEqual(spellings.map(name => [name, "refused", "accepted"]));
        expect(await verdict("other.example.com", agent1Key, agent1Cert)).toBe("accepted");
      } finally {
        server.close();
      }
    });
  });

  it("Bun.serve tls array", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { key: agent2Key, cert: agent2Cert },
        { serverName: "a.example.com", ...SNIContexts["a.example.com"] },
        { serverName: "*.test.com", ...SNIContexts["asterisk.test.com"] },
      ],
      fetch: () => new Response("OK"),
    });
    expect({
      upper: await servedCN(server.port!, "A.EXAMPLE.COM"),
      mixed: await servedCN(server.port!, "a.Example.com"),
      wildcardUpper: await servedCN(server.port!, "B.TEST.COM"),
      noMatch: await servedCN(server.port!, "other.example.org"),
    }).toEqual({
      upper: "agent1",
      mixed: "agent1",
      wildcardUpper: "agent3",
      noMatch: "agent2",
    });
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

  describe.each(["listener", "adopted", "duplex"] as const)("%s transport", kind => {
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

  describe.each(["listener", "duplex"] as const)("%s transport", kind => {
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

    // The refusal still sends its alert after setKeyCert().
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

  // BoringSSL verifies the client against the SSL_CTX that is current when the client's
  // certificate arrives, and a session keeps the id of the context that was current when the
  // handshake began. A switch between the two would leave a session that resumes under the
  // default context with the verdict of another one.
  describe.each(["listener", "adopted"] as const)("%s transport", kind => {
    it("ignores a setKeyCert() that comes after the certificate is picked", async () => {
      const contextB = tls.createSecureContext({ key: agent3Key, cert: agent3Cert, ca: [ca2] });
      const server = createAlpnServer({
        rejectUnauthorized: false,
        ALPNCallback(this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
          // One macrotask later the server's first flight is out and the client's certificate is not in.
          if (protocols[0] === "b") setImmediate(() => this.setKeyCert(contextB));
          return protocols[0];
        },
      });
      server.on("secureConnection", report);
      try {
        using transport = await transports[kind](server);
        const offer = async (alpn: string, session?: Buffer) => {
          const {
            served,
            seen,
            session: issued,
          } = await exchange(
            transport.open({ ...clients.agent3, rejectUnauthorized: false, ALPNProtocols: [alpn], session }),
          );
          return { served, seen, issued };
        };
        const late = await offer("b");
        const again = await offer("a", late.issued);
        // The default context serves agent2 and refuses agent3, on both connections.
        const underDefault = (alpn: string, resumed: boolean) => ({
          served: "agent2",
          seen: { version, alpn, authorized: false, error: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", peer: "agent3", resumed },
        });
        expect({
          late: { served: late.served, seen: late.seen },
          again: { served: again.served, seen: again.seen },
        }).toEqual({ late: underDefault("b", false), again: underDefault("a", true) });
      } finally {
        server.close();
      }
    });
  });

  // As in Node, setKeyCert() replaces the certificate, the key and the CAs of a connection, and the
  // `ciphers` and `sigalgs` stay those of the server.
  // `ciphers` restricts TLS 1.2 only, and a TLS 1.2 handshake with no common signature algorithm
  // moves to a cipher that needs no signature.
  describe.each([
    maxVersion
      ? (["ciphers", "ECDHE-RSA-AES256-GCM-SHA384", "ECDHE-RSA-AES128-GCM-SHA256", "ERR_SSL_NO_SHARED_CIPHER"] as const)
      : (["sigalgs", "rsa_pss_rsae_sha512", "rsa_pss_rsae_sha256", "ERR_SSL_NO_COMMON_SIGNATURE_ALGORITHMS"] as const),
  ])("the %s of the server", (setting, ofServer, ofContext, code) => {
    // Bun hands the TLSSocket to 'connection', before the ClientHello arrives.
    it.each(["in ALPNCallback", "before the handshake"] as const)("stay after setKeyCert() %s", async when => {
      const context = tls.createSecureContext({ key: agent3Key, cert: agent3Cert, [setting]: ofContext });
      const events: string[] = [];
      let settle = () => {};
      const server = tls.createServer({
        key: agent2Key,
        cert: agent2Cert,
        maxVersion,
        [setting]: ofServer,
        ALPNCallback(this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
          events.push("ALPNCallback");
          if (when === "in ALPNCallback") this.setKeyCert(context);
          return protocols[0];
        },
      });
      if (when === "before the handshake") {
        server.on("connection", socket => (socket as tls.TLSSocket).setKeyCert(context));
      }
      server.on("secureConnection", socket => {
        events.push(`served ${(socket.getCertificate() as tls.PeerCertificate).subject.CN}`);
        socket.on("error", () => {});
        socket.end();
        settle();
      });
      server.on("tlsClientError", (err: Error & { code?: string }) => {
        events.push(`${err.code}`);
        settle();
      });
      try {
        using transport = await transports.listener(server);
        // A client that offers what the server allows, then one that offers what the context allows.
        for (const ofClient of [ofServer, ofContext]) {
          const settled = Promise.withResolvers<void>();
          settle = settled.resolve;
          const client = transport.open({ rejectUnauthorized: false, ALPNProtocols: ["a"], [setting]: ofClient });
          client.on("error", () => {});
          // A failure that the server does not report shows as a missing event.
          client.on("close", settled.resolve);
          await settled.promise;
          client.destroy();
        }
        // ALPNCallback runs before BoringSSL looks for a common cipher or signature algorithm.
        expect(events).toEqual(["ALPNCallback", "served agent3", "ALPNCallback", code]);
      } finally {
        server.close();
      }
    });
  });

  // BoringSSL completes a certificate that has no chain from the store of the connection's SSL_CTX,
  // which setKeyCert() keeps. The `ca` of the selected context has to complete it.
  it("presents the intermediate that the `ca` of the selected context holds", async () => {
    // agent6-cert.pem is the agent6 leaf followed by the ca3 intermediate that signed it. ca1 issued ca3.
    const [agent6Leaf, ca3Cert] = agent6Cert.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const context = tls.createSecureContext({ key: agent6Key, cert: agent6Leaf, ca: [ca3Cert] });
    const server = tls.createServer(
      {
        key: agent2Key,
        cert: agent2Cert,
        maxVersion,
        ALPNCallback(this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
          this.setKeyCert(context);
          return protocols[0];
        },
      },
      socket => void socket.on("error", () => {}).end(),
    );
    try {
      using transport = await transports.listener(server);
      // The client trusts the root only, so it verifies the leaf only with the intermediate in hand.
      const client = transport.open({ ca: [ca1], checkServerIdentity: () => undefined, ALPNProtocols: ["a"] });
      await once(client, "secureConnect");
      const seen = { served: client.getPeerCertificate().serialNumber, authorized: client.authorized };
      client.destroy();
      expect(seen).toEqual({ served: new X509Certificate(agent6Leaf).serialNumber, authorized: true });
    } finally {
      server.close();
    }
  });

  // Node's TLSWrap::SetKeyCert.
  it("setKeyCert() throws for a context with no certificate and keeps the one of the server", async () => {
    const thrown: string[] = [];
    const server = createAlpnServer({
      requestCert: false,
      ALPNCallback(this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
        try {
          this.setKeyCert(tls.createSecureContext({ ca: [ca2] }));
        } catch (e) {
          thrown.push((e as Error).message);
        }
        return protocols[0];
      },
    });
    server.on("secureConnection", report);
    try {
      using transport = await transports.listener(server);
      const { served } = await exchange(transport.open({ rejectUnauthorized: false, ALPNProtocols: ["a"] }));
      expect({ thrown, served }).toEqual({ thrown: ["SetKeyCert"], served: "agent2" });
    } finally {
      server.close();
    }
  });

  // ALPNCallback runs before BoringSSL picks the cipher and the session, so that the context it
  // selects decides both. It sees neither, also on a handshake that then resumes. Node runs it
  // after both on such a handshake.
  it("sees no cipher, session or peer certificate yet", async () => {
    const inside: unknown[] = [];
    const server = createAlpnServer({
      rejectUnauthorized: false,
      ALPNCallback(this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
        inside.push({
          version: this.getProtocol(),
          cipher: this.getCipher().name,
          resumed: this.isSessionReused(),
          session: this.getSession() ?? null,
          peer: this.getPeerCertificate()?.subject?.CN ?? null,
        });
        return protocols[0];
      },
    });
    server.on("secureConnection", report);
    try {
      using transport = await transports.listener(server);
      const offer = (session?: Buffer) =>
        exchange(transport.open({ ...clients.agent1, rejectUnauthorized: false, ALPNProtocols: ["a"], session }));
      const first = await offer();
      const second = await offer(first.session);
      const nothingYet = { version, cipher: null, resumed: false, session: null, peer: null };
      expect({ inside, resumed: [first.seen.resumed, second.seen.resumed] }).toEqual({
        inside: [nothingYet, nothingYet],
        resumed: [false, true],
      });
    } finally {
      server.close();
    }
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
      // SNICallback runs first on both versions, so the context that ALPNCallback selects is the
      // one that serves. Node runs ALPNCallback first on TLS 1.3, where OpenSSL negotiates ALPN
      // before its certificate callback, and then serves the context of the SNICallback.
      expect(await bothProtocols(server, "sni.test")).toEqual(afterServerName);
      // The callback already sees the negotiated version, as in Node.
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

  // setKeyCert() keeps the SSL_CTX of the connection, where BoringSSL reads the callbacks of the
  // handshake.
  describe("after setKeyCert() before the handshake", () => {
    const contextB = tls.createSecureContext({ key: agent3Key, cert: agent3Cert, ca: [ca2] });

    // Bun hands the TLSSocket to 'connection', before the ClientHello arrives.
    it("still runs, after the SNICallback", async () => {
      const calls: string[] = [];
      const server = createAlpnServer(
        {
          rejectUnauthorized: false,
          SNICallback(servername, callback) {
            calls.push(`sni:${servername}`);
            callback(null);
          },
        },
        calls,
      );
      server.on("connection", socket => (socket as tls.TLSSocket).setKeyCert(contextB));
      server.on("secureConnection", report);
      try {
        expect(await bothProtocols(server, "sni.test")).toEqual([
          { served: "agent3", alpn: "a", authorized: false },
          { served: "agent3", alpn: "b", authorized: false },
        ]);
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

    it("negotiates from ALPNProtocols", async () => {
      const server = tls.createServer(
        { key: agent2Key, cert: agent2Cert, maxVersion, ALPNProtocols: ["b", "a"] },
        report,
      );
      server.on("connection", socket => (socket as tls.TLSSocket).setKeyCert(contextB));
      try {
        using transport = await transports.listener(server);
        const { served, seen } = await exchange(transport.open({ rejectUnauthorized: false, ALPNProtocols: ["a"] }));
        expect({ served, alpn: seen.alpn }).toEqual({ served: "agent3", alpn: "a" });
      } finally {
        server.close();
      }
    });

    it.each(["ALPNCallback", "ALPNProtocols"] as const)(
      "negotiates from the %s of a server-side TLSSocket over a Duplex",
      async option => {
        const [clientSide, serverSide] = duplexPair();
        const wrapped = new tls.TLSSocket(serverSide, {
          isServer: true,
          key: agent2Key,
          cert: agent2Cert,
          maxVersion,
          ...(option === "ALPNCallback"
            ? { ALPNCallback: ({ protocols }: { protocols: string[] }) => protocols[0] }
            : { ALPNProtocols: ["b", "a"] }),
        });
        wrapped.on("secure", () => report(wrapped));
        // The TLS engine of a wrapped socket starts on the tick after its constructor.
        await new Promise<void>(resolve => setImmediate(resolve));
        wrapped.setKeyCert(contextB);
        const { served, seen } = await exchange(
          tls.connect({ socket: clientSide, rejectUnauthorized: false, ALPNProtocols: ["a"] }),
        );
        expect({ served, alpn: seen.alpn }).toEqual({ served: "agent3", alpn: "a" });
      },
    );

    it.each([
      ["nothing", "agent3"],
      ["a context", "agent1"],
    ] as const)("asks the SNICallback of a server-side TLSSocket, which selects %s", async (answer, served) => {
      using stack = new DisposableStack();
      const asked: string[] = [];
      const selected = tls.createSecureContext({ key: agent1Key, cert: agent1Cert });
      const ready = Promise.withResolvers<void>();
      const raw = net.createServer(socket => {
        const wrapped = new tls.TLSSocket(socket, {
          isServer: true,
          key: agent2Key,
          cert: agent2Cert,
          maxVersion,
          SNICallback(servername, callback) {
            asked.push(servername);
            callback(null, answer === "a context" ? selected : undefined);
          },
        });
        wrapped.on("error", () => {});
        wrapped.on("secure", () => wrapped.end());
        // The TLS engine of a wrapped socket starts on the tick after its constructor.
        setImmediate(() => {
          wrapped.setKeyCert(contextB);
          ready.resolve();
        });
      });
      stack.defer(() => void raw.close());
      await once(raw.listen(0, "127.0.0.1"), "listening");
      const plain = net.connect((raw.address() as AddressInfo).port, "127.0.0.1");
      stack.defer(() => void plain.destroy());
      await Promise.all([once(plain, "connect"), ready.promise]);
      const client = tls.connect({ socket: plain, servername: "sni.test", rejectUnauthorized: false });
      stack.defer(() => void client.destroy());
      await once(client, "secureConnect");
      expect({ asked, served: client.getPeerCertificate().subject.CN }).toEqual({ asked: ["sni.test"], served });
    });
  });

  it("does not run when the client and the server share no protocol version", async () => {
    const calls: string[] = [];
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
    for (at += 2; at < hello.length;) {
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

  // `record` is the type of the first record the server answers with: 22 is a handshake record
  // (the ServerHello: the handshake went on with the answer of the callback), 21 is an alert.
  const refused = { calls: [], record: 21, error: "ERR_SSL_PARSE_TLSEXT" };
  // The longest protocol name the length byte allows.
  const longest = Buffer.alloc(255, "n");
  it.each([
    ["runs for the list a real client sends", [0, 3, 2, 0x61, 0x62], { calls: [["ab"]], record: 22, error: null }],
    [
      "runs for a protocol name of 255 bytes",
      [1, 0, 255, ...longest],
      { calls: [[`${longest}`]], record: 22, error: null },
    ],
    [
      "runs for a protocol name of 255 bytes before another one",
      [1, 2, 255, ...longest, 1, 0x61],
      { calls: [[`${longest}`, "a"]], record: 22, error: null },
    ],
    ["does not run for an empty list", [0, 0], refused],
    ["does not run for an empty protocol name", [0, 3, 0, 1, 0x62], refused],
    ["does not run for an empty protocol name at the end", [0, 3, 1, 0x61, 0], refused],
    ["does not run for a protocol name longer than the list", [0, 3, 3, 0x61, 0x62], refused],
    ["does not run for a last protocol name longer than the list", [0, 4, 1, 0x61, 2, 0x62], refused],
    ["does not run for a byte after the list", [0, 3, 2, 0x61, 0x62, 0], refused],
    ["does not run for a protocol name after the list", [0, 3, 2, 0x61, 0x62, 1, 0x63], refused],
    ["does not run for a list longer than the extension", [0, 9, 2, 0x61, 0x62], refused],
  ] as const)("%s", async (_name, body, expected) => {
    const calls: string[][] = [];
    const refusal = Promise.withResolvers<string>();
    const server = tls.createServer({
      key: agent2Key,
      cert: agent2Cert,
      ALPNCallback({ protocols }) {
        calls.push(protocols);
        return protocols[0];
      },
    });
    server.on("tlsClientError", (err: Error & { code?: string }) => refusal.resolve(err.code ?? err.message));
    const hello = await clientHelloWithAlpn(Buffer.from(body));
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const raw = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
      raw.on("error", () => {});
      const answered = Promise.race([
        once(raw, "data").then(([chunk]) => chunk[0]),
        once(raw, "close").then(() => "closed with no answer"),
      ]);
      raw.write(hello);
      const record = await answered;
      const error = record === 21 ? await refusal.promise : null;
      raw.destroy();
      expect({ calls, record, error }).toEqual(expected);
    } finally {
      server.close();
    }
  });
});

// setKeyCert() gives a connection every certificate of its context and none of those it had.
describe("setKeyCert() with one certificate per key type", () => {
  const rsa2 = { key: agent2Key, cert: agent2Cert };
  const rsa3 = { key: agent3Key, cert: agent3Cert };
  const ec10 = { key: loadPEM("ec10-key.pem"), cert: loadPEM("ec10-cert.pem") };
  const withEc10 = (rsa: typeof rsa3) => ({ key: [rsa.key, ec10.key], cert: [rsa.cert, ec10.cert] });
  const refused = "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE";

  // The CN of the certificate that a client of each kind is served, or its error code.
  async function servedToEachKindOfClient(server: tls.Server) {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const kinds = {
      "TLS 1.2, ECDSA only": { maxVersion: "TLSv1.2", ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256" },
      "TLS 1.2, RSA only": { maxVersion: "TLSv1.2", ciphers: "ECDHE-RSA-AES128-GCM-SHA256" },
      "TLS 1.3, ECDSA only": { sigalgs: "ecdsa_secp256r1_sha256" },
      "TLS 1.3, RSA only": { sigalgs: "rsa_pss_rsae_sha256" },
    } as const;
    const served: Record<string, string> = {};
    for (const [kind, options] of Object.entries(kinds)) {
      const { promise, resolve } = Promise.withResolvers<string>();
      const client = tls.connect({
        host: "127.0.0.1",
        port,
        rejectUnauthorized: false,
        ALPNProtocols: ["a"],
        ...options,
      });
      client.on("secureConnect", () => resolve(client.getPeerCertificate().subject.CN));
      client.on("error", err => resolve((err as NodeJS.ErrnoException).code ?? err.message));
      client.on("close", () => resolve("closed"));
      served[kind] = await promise;
      client.destroy();
    }
    return served;
  }

  it.each([
    ["one certificate on a server with two", withEc10(rsa2), rsa3, { ecdsa: refused, rsa: "agent3" }],
    ["two certificates on a server with one", rsa2, withEc10(rsa3), { ecdsa: "agent10.example.com", rsa: "agent3" }],
    // The certificates beside the first one carry no signing preferences of their own.
    [
      "the first of two certificates on a server with `sigalgs`",
      { ...rsa2, sigalgs: "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256" },
      withEc10(rsa3),
      { ecdsa: "agent10.example.com", rsa: refused },
    ],
  ] as const)("serves %s", async (_name, ofServer, ofContext, expected) => {
    const context = tls.createSecureContext(ofContext);
    const server = tls.createServer(
      {
        ...ofServer,
        ALPNCallback(this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
          this.setKeyCert(context);
          return protocols[0];
        },
      },
      socket => void socket.on("error", () => {}).end(),
    );
    server.on("tlsClientError", () => {});
    try {
      expect(await servedToEachKindOfClient(server)).toEqual({
        "TLS 1.2, ECDSA only": expected.ecdsa,
        "TLS 1.2, RSA only": expected.rsa,
        "TLS 1.3, ECDSA only": expected.ecdsa,
        "TLS 1.3, RSA only": expected.rsa,
      });
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

it("only tls.Server counts a falsy crl as absent", () => {
  // tls.Server#setSecureContext() stores undefined for a falsy crl. configSecureContext(),
  // behind every other entry point, only skips null and undefined:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1471-L1474
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L261-L271
  const server = tls.createServer({ key: agent1Key, cert: agent1Cert });
  for (const [crl, code] of [
    ["", "ERR_CRYPTO_OPERATION_FAILED"],
    [false, "ERR_INVALID_ARG_TYPE"],
    [0, "ERR_INVALID_ARG_TYPE"],
  ] as [never, string][]) {
    const rejected = expect.objectContaining({ code });
    expect(() => tls.createSecureContext({ crl })).toThrow(rejected);
    expect(() => server.addContext("example.com", { crl })).toThrow(rejected);
    expect(() => tls.connect({ socket: new Duplex({ read() {} }), crl })).toThrow(rejected);
    expect((tls.createServer({ crl }) as any).crl).toBeUndefined();
  }
  // An empty array is truthy. tls.Server keeps it, and it names no CRL.
  expect((tls.createServer({ crl: [] }) as any).crl).toEqual([]);
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

describe("sessionTimeout", () => {
  // SSLSession ::= SEQUENCE { ..., timeout [2] INTEGER, ..., ticketLifetimeHint [9] INTEGER OPTIONAL, ... }
  // BoringSSL folds a TLS 1.3 server's ticket lifetime into `timeout`; OpenSSL keeps it in the hint.
  function sessionLifetime(der: Uint8Array) {
    let pos = 0;
    function readHeader() {
      const tag = der[pos++];
      let length = der[pos++];
      if (length & 0x80) {
        const lengthBytes = length & 0x7f;
        length = 0;
        for (let i = 0; i < lengthBytes; i++) length = length * 256 + der[pos++];
      }
      return { tag, end: pos + length };
    }
    function readInteger(end: number) {
      const integer = readHeader();
      expect(integer.tag).toBe(0x02);
      expect(integer.end).toBe(end);
      let value = 0;
      for (; pos < integer.end; pos++) value = value * 256 + der[pos];
      return value;
    }
    const sequence = readHeader();
    expect(sequence.tag).toBe(0x30);
    let timeout: number | undefined;
    let ticketLifetimeHint: number | undefined;
    while (pos < sequence.end) {
      const element = readHeader();
      if (element.tag === 0xa2) timeout = readInteger(element.end);
      else if (element.tag === 0xa9) ticketLifetimeHint = readInteger(element.end);
      pos = element.end;
    }
    return Math.min(timeout!, ticketLifetimeHint ?? Infinity);
  }

  // BoringSSL holds TLS 1.3 tickets back until the server's first write; `request` provokes it.
  async function firstSessionFrom(port: number, clientOptions: tls.ConnectionOptions = {}, request?: string) {
    const startedAt = Date.now();
    const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...clientOptions });
    try {
      socket.resume();
      if (request !== undefined) {
        await once(socket, "secureConnect");
        socket.write(request);
      }
      const session = await new Promise<Buffer>((resolve, reject) => {
        socket.once("session", resolve);
        socket.once("error", reject);
        socket.once("close", () => reject(new Error("connection closed before the server issued a session")));
      });
      // A lifetime counts from ticket issuance: each second boundary crossed since then takes one off.
      const skew = Math.ceil((Date.now() - startedAt) / 1000) + 1;
      return { protocol: socket.getProtocol(), lifetime: sessionLifetime(session), skew };
    } finally {
      socket.destroy();
    }
  }

  async function withTlsServer(options: tls.TlsOptions, clientOptions?: tls.ConnectionOptions) {
    const server = tls.createServer({ key: agent1Key, cert: agent1Cert, ...options }, socket => socket.end("x"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      return await firstSessionFrom((server.address() as AddressInfo).port, clientOptions);
    } finally {
      server.close();
    }
  }

  it("tls.createServer({ sessionTimeout }) is the lifetime of the tickets it issues", async () => {
    for (const maxVersion of ["TLSv1.3", "TLSv1.2"] as const) {
      const { protocol, lifetime, skew } = await withTlsServer({ sessionTimeout: 7, maxVersion });
      expect(protocol).toBe(maxVersion);
      expect(lifetime).toBeWithin(7 - skew, 8);
    }
  });

  it("tls.connect({ sessionTimeout }) caps the lifetime of the TLS 1.3 sessions the client keeps", async () => {
    const { protocol, lifetime, skew } = await withTlsServer({}, { sessionTimeout: 9 } as tls.ConnectionOptions);
    expect(protocol).toBe("TLSv1.3");
    expect(lifetime).toBeWithin(9 - skew, 10);
  });

  it("Bun.serve({ tls: { sessionTimeout } }) is the lifetime of the TLS 1.3 tickets it issues", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: agent1Key, cert: agent1Cert, sessionTimeout: 7 } as Bun.TLSOptions,
      fetch: () => new Response("ok"),
    });
    const request = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    const { protocol, lifetime, skew } = await firstSessionFrom(server.port!, {}, request);
    expect(protocol).toBe("TLSv1.3");
    expect(lifetime).toBeWithin(7 - skew, 8);
  });
});

it("getCiphers() lists the supported cipher names, lower-cased and sorted", () => {
  const ciphers = tls.getCiphers();
  expect(ciphers).toEqual([...new Set(ciphers)].sort());
  expect(ciphers).toEqual(ciphers.map(name => name.toLowerCase()));
  expect(ciphers).toEqual(
    expect.arrayContaining([
      "aes256-sha",
      "ecdhe-rsa-aes128-gcm-sha256",
      "tls_aes_128_gcm_sha256",
      "tls_aes_256_gcm_sha384",
      "tls_chacha20_poly1305_sha256",
    ]),
  );
  for (const name of ciphers) expect(() => tls.createSecureContext({ ciphers: name.toUpperCase() })).not.toThrow();

  tls.getCiphers().length = 0;
  expect(tls.getCiphers()).toEqual(ciphers);
});

it("tls.SecureContext is the class of what createSecureContext() returns", () => {
  const context = tls.createSecureContext({});
  expect(context).toBeInstanceOf((tls as any).SecureContext);
  expect(context.constructor).toBe((tls as any).SecureContext);
  expect(Object.keys((tls as any).SecureContext.prototype)).toEqual([]);
  expect({}).not.toBeInstanceOf((tls as any).SecureContext);
  expect(new (tls as any).SecureContext()).toBeInstanceOf((tls as any).SecureContext);
  expect((tls as any).SecureContext()).toBeInstanceOf((tls as any).SecureContext);
});
