/**
 * tlsSocket.setKeyCert() on a server-side socket. Node.js puts the certificate, the key and the CA of the context on the
 * connection, and the handshake goes on as before: the answer of the SNICallback is awaited and ALPN is negotiated.
 * https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1656-L1681
 *
 * Works with both:
 *   bun bd test test/js/node/tls/node-tls-setkeycert.test.ts
 *   node --test test/js/node/tls/node-tls-setkeycert.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";

const onBun = typeof Bun !== "undefined";
const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const fixtures = join(import.meta.dirname, "fixtures");
const pem = (name: string) => readFileSync(join(keys, name));
const identity = (name: string) => ({ key: pem(`${name}-key.pem`), cert: pem(`${name}-cert.pem`) });
// The server's own certificate is agent2, and most tests give the connection agent1. ca1 issued agent1 and ca2 issued
// agent3. The keys of ec10 (CN agent10.example.com) and of ec (CN agent2) are on the curve P-256, the others are RSA.
const own = identity("agent2");
const other = tls.createSecureContext(identity("agent1"));
const third = tls.createSecureContext(identity("agent3"));

type Answer = (err: Error | null, context?: tls.SecureContext) => void;
type SNICallback = (this: tls.TLSSocket, servername: string, answer: Answer) => void;
type Version = "TLSv1.2" | "TLSv1.3";
type Context = tls.SecureContext | tls.SecureContextOptions;
const versions = ["TLSv1.2", "TLSv1.3"] as const;

async function listen(server: net.Server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" };
}

// A Duplex in front of the socket: the server-side TLS then runs over a stream, and not over the socket itself.
function overDuplex(raw: net.Socket) {
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
    destroy(err, callback) {
      raw.destroy();
      callback(err);
    },
  });
  raw.on("data", chunk => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  raw.on("error", () => {});
  raw.on("close", () => duplex.destroy());
  return duplex;
}

// A door makes the server-side TLSSocket of each connection.
type Dial = { port: number; host: string };
type Door = { dial: Dial; close(): void };
type Report = {
  onSecure?: (socket: tls.TLSSocket) => void;
  onError?: (err: Error) => void;
  onServer?: (server: tls.Server) => void;
};
type OpenDoor = (options: tls.TlsOptions, report?: Report) => Promise<Door>;

function emitter(over: (raw: net.Socket) => Duplex): OpenDoor {
  return async (options, report = {}) => {
    const server = tls.createServer(options, socket => {
      socket.on("error", () => {});
      report.onSecure?.(socket);
    });
    server.on("tlsClientError", err => report.onError?.(err));
    const front = net.createServer(raw => server.emit("connection", over(raw)));
    return { dial: await listen(front), close: () => front.close() };
  };
}

function wrapper(over: (raw: net.Socket) => Duplex): OpenDoor {
  return async (options, report = {}) => {
    const front = net.createServer(raw => {
      const socket = new tls.TLSSocket(over(raw), { ...options, isServer: true });
      socket.on("error", err => report.onError?.(err));
      socket.on("secure", () => report.onSecure?.(socket));
    });
    return { dial: await listen(front), close: () => front.close() };
  };
}

// On these, `this` in the SNICallback is the TLSSocket of the connection.
const doors: Record<string, OpenDoor> = {
  // Node.js calls the SNICallback of a listening server with the socket as `this`. Where Bun does not do that yet, the
  // socket comes from 'connection', which Bun emits with the TLSSocket.
  "server.listen()": async (options, report = {}) => {
    let accepted: tls.TLSSocket | undefined;
    const callback = options.SNICallback as SNICallback | undefined;
    const SNICallback = function (this: unknown, servername: string, answer: Answer) {
      callback!.call(this instanceof tls.TLSSocket ? this : accepted!, servername, answer);
    };
    const server = tls.createServer({ ...options, ...(callback && { SNICallback }) }, socket => {
      socket.on("error", () => {});
      report.onSecure?.(socket);
    });
    server.on("connection", socket => (accepted = socket as tls.TLSSocket));
    server.on("tlsClientError", err => report.onError?.(err));
    report.onServer?.(server);
    return { dial: await listen(server), close: () => server.close() };
  },
  "server.emit('connection', netSocket)": emitter(raw => raw),
  "new TLSSocket(netSocket, { isServer: true })": wrapper(raw => raw),
};
// Bun does not call an SNICallback for a connection over a stream.
const streamDoors: Record<string, OpenDoor> = {
  "server.emit('connection', duplex)": emitter(overDuplex),
  "new TLSSocket(duplex, { isServer: true })": wrapper(overDuplex),
};
const emit = doors["server.emit('connection', netSocket)"];
const wrap = doors["new TLSSocket(netSocket, { isServer: true })"];

async function serve<T>(open: OpenDoor, options: tls.TlsOptions, run: (dial: Dial) => T | Promise<T>, report?: Report) {
  const opened = await open(options, report);
  try {
    return await run(opened.dial);
  } finally {
    opened.close();
  }
}

// When the SNICallback answers, after its setKeyCert() call.
const answers: Record<string, (answer: Answer, context?: tls.SecureContext) => void> = {
  "in the call": (answer, context) => answer(null, context),
  "from a microtask": (answer, context) => queueMicrotask(() => answer(null, context)),
  "on a later turn": (answer, context) => setImmediate(answer, null, context),
};

const pick = (context: Context | (() => Context)) => (typeof context === "function" ? context() : context);
// An SNICallback that calls setKeyCert() and then selects nothing.
const applies = (context: Context | (() => Context)): SNICallback =>
  function (_, answer) {
    this.setKeyCert(pick(context));
    answer(null);
  };
// An ALPNCallback that calls setKeyCert() and then selects the first protocol.
const selects = (context: Context | (() => Context)) =>
  function (this: tls.TLSSocket, { protocols }: { protocols: string[] }) {
    this.setKeyCert(pick(context));
    return protocols[0];
  };

const served = (client: tls.TLSSocket) => ({ cn: client.getPeerCertificate().subject.CN, alpn: client.alpnProtocol });
const refused = () => "refused" as const;

// One handshake that offers h2. `read` takes the result from the client, by default its certificate and protocol.
// `session` is the one that the server issues, which can come before or after 'secureConnect'.
async function handshake<T = ReturnType<typeof served>>(
  dial: Dial,
  version: Version,
  options: tls.ConnectionOptions = {},
  read: (client: tls.TLSSocket, session: Promise<Buffer>) => T | Promise<T> = served as (client: tls.TLSSocket) => T,
) {
  const client = tls.connect({
    ...dial,
    servername: "a.test",
    ALPNProtocols: ["h2"],
    rejectUnauthorized: false,
    minVersion: version,
    maxVersion: version,
    ...options,
  });
  const session = once(client, "session").then(([issued]) => issued as Buffer);
  session.catch(() => {});
  try {
    await once(client, "secureConnect");
    return await read(client, session);
  } finally {
    client.destroy();
  }
}

// A client that takes a certificate of one key type only.
const only = (type: "RSA" | "ECDSA", version: Version): tls.ConnectionOptions =>
  version === "TLSv1.2"
    ? { ciphers: `ECDHE-${type}-AES128-GCM-SHA256` }
    : { sigalgs: type === "RSA" ? "rsa_pss_rsae_sha256" : "ecdsa_secp256r1_sha256" };

// How many certificates came: the peer's own and the issuers with it.
function chainLength(socket: tls.TLSSocket) {
  const sent = new Set<string>();
  let cert = socket.getPeerCertificate(true);
  while (cert?.raw && !sent.has(cert.fingerprint256)) {
    sent.add(cert.fingerprint256);
    cert = cert.issuerCertificate;
  }
  return sent.size;
}

// The first flight of a client: one ClientHello record, for a peer that sends nothing more.
async function clientHello(version: Version) {
  const { promise, resolve } = Promise.withResolvers<Buffer>();
  const sink = net.createServer(raw => {
    let seen = Buffer.alloc(0);
    raw.on("error", () => {});
    raw.on("data", (chunk: Buffer) => {
      seen = Buffer.concat([seen, chunk]);
      if (seen.length >= 5 && seen.length >= 5 + seen.readUInt16BE(3))
        resolve(seen.subarray(0, 5 + seen.readUInt16BE(3)));
    });
  });
  const client = tls.connect({
    ...(await listen(sink)),
    servername: "a.test",
    rejectUnauthorized: false,
    minVersion: version,
    maxVersion: version,
  });
  client.on("error", () => {});
  try {
    return await promise;
  } finally {
    client.destroy();
    sink.close();
  }
}

// The handshake messages in a flight of TLS 1.2, which sends them in the clear: the body of each, by its type.
function handshakeMessages(flight: Buffer) {
  const records: Buffer[] = [];
  for (let at = 0; at + 5 <= flight.length; at += 5 + flight.readUInt16BE(at + 3)) {
    if (flight[at] === 22) records.push(flight.subarray(at + 5, at + 5 + flight.readUInt16BE(at + 3)));
  }
  const stream = Buffer.concat(records);
  const messages = new Map<number, Buffer>();
  for (let at = 0; at + 4 <= stream.length; at += 4 + stream.readUIntBE(at + 1, 3)) {
    messages.set(stream[at], stream.subarray(at + 4, at + 4 + stream.readUIntBE(at + 1, 3)));
  }
  return messages;
}
const CERTIFICATE_REQUEST = 13;
const SERVER_HELLO_DONE = 14;

// Which of the three CAs a TLS 1.2 server names in its request for a client certificate. The peer reads up to the
// ServerHelloDone and stops.
async function namedCAs(dial: Dial) {
  const hello = await clientHello("TLSv1.2");
  const peer = net.connect(dial);
  const flight = Promise.withResolvers<Map<number, Buffer>>();
  let received = Buffer.alloc(0);
  peer.on("error", flight.reject);
  peer.on("close", () => flight.reject(new Error("the server closed before its ServerHelloDone")));
  peer.on("data", (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
    const messages = handshakeMessages(received);
    if (messages.has(SERVER_HELLO_DONE)) flight.resolve(messages);
  });
  try {
    peer.write(hello);
    const names = (await flight.promise).get(CERTIFICATE_REQUEST)?.toString("latin1") ?? "";
    return { ca1: names.includes("ca1"), ca2: names.includes("ca2"), ca3: names.includes("ca3") };
  } finally {
    peer.destroy();
  }
}

for (const [door, open] of Object.entries({ ...doors, ...streamDoors })) {
  for (const version of versions) {
    const suite = onBun && door in streamDoors ? describe.skip : describe;
    suite(`setKeyCert() in an SNICallback, ${door}, ${version}`, () => {
      for (const [when, give] of Object.entries(answers)) {
        const SNICallback: SNICallback = function (_, answer) {
          this.setKeyCert(other);
          give(answer);
        };

        test(`ALPNProtocols still apply when the answer comes ${when}`, async () => {
          const got = await serve(open, { ...own, SNICallback, ALPNProtocols: ["h2"] }, dial =>
            handshake(dial, version),
          );
          assert.deepStrictEqual(got, { cn: "agent1", alpn: "h2" });
        });

        test(`the ALPNCallback still runs once when the answer comes ${when}`, async () => {
          let calls = 0;
          const ALPNCallback = ({ protocols }: { protocols: string[] }) => {
            calls++;
            return protocols[0];
          };
          const got = await serve(open, { ...own, SNICallback, ALPNCallback }, dial => handshake(dial, version));
          assert.deepStrictEqual({ ...got, calls }, { cn: "agent1", alpn: "h2", calls: 1 });
        });
      }

      test("the call can come on a later turn, before the answer", async () => {
        const SNICallback: SNICallback = function (_, answer) {
          setImmediate(() => {
            this.setKeyCert(other);
            answer(null);
          });
        };
        const got = await serve(open, { ...own, SNICallback, ALPNProtocols: ["h2"] }, dial => handshake(dial, version));
        assert.deepStrictEqual(got, { cn: "agent1", alpn: "h2" });
      });

      // The peer sends its ClientHello and nothing more, so every byte it gets was sent before the answer.
      test("the server sends nothing before the answer, and a refusal drops the connection", async () => {
        const refusal = new Error("denied");
        const reported = Promise.withResolvers<Error>();
        let secured = false;
        const SNICallback: SNICallback = function (_, answer) {
          this.setKeyCert(other);
          setImmediate(answer, refusal);
        };
        const hello = await clientHello(version);
        const got = await serve(
          open,
          { ...own, SNICallback },
          async dial => {
            const peer = net.connect(dial);
            let received = 0;
            peer.on("error", () => {});
            peer.on("data", chunk => (received += chunk.length));
            try {
              peer.write(hello);
              const [err] = await Promise.all([reported.promise, once(peer, "close")]);
              return { received, secured, isTheRefusal: err === refusal };
            } finally {
              peer.destroy();
            }
          },
          { onSecure: () => (secured = true), onError: reported.resolve },
        );
        assert.deepStrictEqual(got, { received: 0, secured: false, isTheRefusal: true });
      });

      // The connection is on the server's own context here, and the answer can name that one or another.
      for (const [when, give] of [Object.entries(answers)[0], Object.entries(answers)[2]]) {
        test(`a context in the answer replaces the one of the call, when the answer comes ${when}`, async () => {
          const secureContext = tls.createSecureContext(own);
          const answered: Record<string, unknown> = {};
          for (const [which, context] of Object.entries({
            "another context": third,
            "the server's own": secureContext,
          })) {
            const SNICallback: SNICallback = function (_, answer) {
              this.setKeyCert(other);
              give(answer, context);
            };
            const options = { secureContext, SNICallback, ALPNProtocols: ["h2"] };
            answered[which] = await serve(open, options, dial => handshake(dial, version));
          }
          assert.deepStrictEqual(answered, {
            "another context": { cn: "agent3", alpn: "h2" },
            "the server's own": { cn: "agent2", alpn: "h2" },
          });
        });
      }
    });

    // The use that the Node.js documentation names for setKeyCert().
    test(`setKeyCert() in an ALPNCallback replaces the certificate, ${door}, ${version}`, async () => {
      const got = await serve(open, { ...own, ALPNCallback: selects(other) }, dial => handshake(dial, version));
      assert.deepStrictEqual(got, { cn: "agent1", alpn: "h2" });
    });
  }
}

for (const version of versions) {
  describe(`what setKeyCert() puts on the connection, ${version}`, () => {
    test("the last of two calls wins", async () => {
      const SNICallback: SNICallback = function (_, answer) {
        this.setKeyCert(other);
        this.setKeyCert(third);
        answer(null);
      };
      const got = await serve(emit, { ...own, SNICallback, ALPNProtocols: ["h2"] }, dial => handshake(dial, version));
      assert.deepStrictEqual(got, { cn: "agent3", alpn: "h2" });
    });

    // Node.js does not look at the addContext() entries of a server that has an SNICallback. Bun looks when the
    // SNICallback selects nothing, but not for a connection that has the certificate of a setKeyCert() call.
    for (const [when, give] of [Object.entries(answers)[0], Object.entries(answers)[2]]) {
      test(`an addContext() entry for the name does not replace it, when the answer comes ${when}`, async () => {
        const SNICallback: SNICallback = function (_, answer) {
          this.setKeyCert(other);
          give(answer);
        };
        const got = await serve(
          doors["server.listen()"],
          { ...own, SNICallback, ALPNProtocols: ["h2"] },
          dial => handshake(dial, version),
          { onServer: server => server.addContext("a.test", identity("agent3")) },
        );
        assert.deepStrictEqual(got, { cn: "agent1", alpn: "h2" });
      });
    }

    test("the options of a context do as a context", async () => {
      const options = { ...own, SNICallback: applies(identity("agent1")), ALPNProtocols: ["h2"] };
      assert.deepStrictEqual(await serve(emit, options, dial => handshake(dial, version)), {
        cn: "agent1",
        alpn: "h2",
      });
    });

    test("a context without a certificate throws, and the connection keeps its own", async () => {
      const thrown: unknown[] = [];
      const SNICallback: SNICallback = function (_, answer) {
        for (const context of [tls.createSecureContext(), tls.createSecureContext({ ca: pem("ca1-cert.pem") })]) {
          try {
            this.setKeyCert(context);
          } catch (err) {
            thrown.push(err);
          }
        }
        answer(null);
      };
      const got = await serve(emit, { ...own, SNICallback, ALPNProtocols: ["h2"] }, dial => handshake(dial, version));
      assert.deepStrictEqual(
        { ...got, thrown: thrown.map(err => (err instanceof Error ? `${err.name}: ${err.message}` : err)) },
        { cn: "agent2", alpn: "h2", thrown: ["Error: SetKeyCert", "Error: SetKeyCert"] },
      );
    });

    test("a context without a certificate in an ALPNCallback, not caught, refuses the handshake", async () => {
      const options = { ...own, ALPNCallback: selects(() => tls.createSecureContext()) };
      assert.strictEqual(await serve(emit, options, dial => handshake(dial, version).catch(refused)), "refused");
    });

    // Of two certificates only the RSA one has its key.
    test("a context with a certificate that has no key serves the one that has its key", async () => {
      const context = tls.createSecureContext({
        cert: [pem("agent1-cert.pem"), pem("ec10-cert.pem")],
        key: [pem("agent1-key.pem")],
      });
      const options = { ...identity("agent3"), SNICallback: applies(context), ALPNProtocols: ["h2"] };
      assert.deepStrictEqual(await serve(emit, options, dial => handshake(dial, version)), {
        cn: "agent1",
        alpn: "h2",
      });
    });

    test("a key on the same curve in an ALPNCallback replaces the certificate", async () => {
      const context = tls.createSecureContext(identity("ec"));
      const got = await serve(emit, { ...identity("ec10"), ALPNCallback: selects(context) }, dial =>
        handshake(dial, version, {}, client => ({ ...served(client), curve: client.getPeerCertificate().asn1Curve })),
      );
      assert.deepStrictEqual(got, { cn: "agent2", alpn: "h2", curve: "prime256v1" });
    });

    // The certificate follows the cipher suite (TLS 1.2) or the signature algorithm (TLS 1.3), and an ECDSA client
    // keeps the ECDSA certificate.
    test("a key of another type in an ALPNCallback leaves the certificate", async () => {
      const options = { ...identity("ec10"), ALPNCallback: selects(other) };
      const got = await serve(emit, options, dial => handshake(dial, version));
      assert.deepStrictEqual(got, { cn: "agent10.example.com", alpn: "h2" });
    });

    // The server trusts ca1 and the context trusts ca2. In the ALPNCallback the key is of another type, so the
    // certificate stays, and the CA moves all the same.
    for (const [where, callbacks] of [
      ["an SNICallback", (context: tls.SecureContext) => ({ ...own, SNICallback: applies(context) })],
      ["an ALPNCallback", (context: tls.SecureContext) => ({ ...identity("ec10"), ALPNCallback: selects(context) })],
    ] as const) {
      const trustsCa2 = () => tls.createSecureContext({ ...identity("agent1"), ca: pem("ca2-cert.pem") });

      test(`the CA of the context verifies the client certificate, from ${where}`, async () => {
        let verdict = Promise.withResolvers<string>();
        const options = {
          ...callbacks(trustsCa2()),
          ca: pem("ca1-cert.pem"),
          requestCert: true,
          rejectUnauthorized: false,
        };
        const verdicts = await serve(
          emit,
          options,
          async dial => {
            const each: string[] = [];
            for (const client of ["agent1", "agent3"]) {
              each.push(await handshake(dial, version, identity(client), () => verdict.promise));
              verdict = Promise.withResolvers<string>();
            }
            return each;
          },
          { onSecure: socket => verdict.resolve(socket.authorized ? "authorized" : String(socket.authorizationError)) },
        );
        assert.deepStrictEqual(verdicts, ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "authorized"]);
      });

      test(`a server that rejects takes only the clients of the context's CA, from ${where}`, async () => {
        let outcome = Promise.withResolvers<string>();
        const options = { ...callbacks(trustsCa2()), ca: pem("ca1-cert.pem"), requestCert: true };
        const outcomes = await serve(
          emit,
          options,
          async dial => {
            const each: string[] = [];
            for (const name of ["agent1", "agent3"]) {
              const client = tls.connect({
                ...dial,
                ...identity(name),
                servername: "a.test",
                ALPNProtocols: ["h2"],
                rejectUnauthorized: false,
                minVersion: version,
                maxVersion: version,
              });
              client.on("error", () => {});
              each.push(await outcome.promise);
              client.destroy();
              outcome = Promise.withResolvers<string>();
            }
            return each;
          },
          { onSecure: () => outcome.resolve("accepted"), onError: () => outcome.resolve("refused") },
        );
        assert.deepStrictEqual(outcomes, ["refused", "accepted"]);
      });
    }

    // Not from the CA of the context: the server finds the issuer of agent1 in its own CA, and none for agent3.
    test("getPeerCertificate(true) looks for the issuer in the CA of the server", async () => {
      const trustsCa2 = tls.createSecureContext({ ...identity("agent1"), ca: pem("ca2-cert.pem") });
      let chain = Promise.withResolvers<number>();
      const options = {
        ...own,
        ca: pem("ca1-cert.pem"),
        requestCert: true,
        rejectUnauthorized: false,
        SNICallback: applies(trustsCa2),
      };
      const chains = await serve(
        emit,
        options,
        async dial => {
          const each: number[] = [];
          for (const client of ["agent1", "agent3"]) {
            each.push(await handshake(dial, version, identity(client), () => chain.promise));
            chain = Promise.withResolvers<number>();
          }
          return each;
        },
        { onSecure: socket => chain.resolve(chainLength(socket)) },
      );
      assert.deepStrictEqual(chains, [2, 1]);
    });

    // agent6.pfx holds the two certificates above agent6, and agent6-cert.pem holds the first of them.
    test("the intermediate certificates of the context are sent", async () => {
      const contexts = [
        tls.createSecureContext({ pfx: pem("agent6.pfx"), passphrase: "sample" }),
        tls.createSecureContext(identity("agent6")),
      ];
      let next = 0;
      const sent = await serve(emit, { ...own, SNICallback: applies(() => contexts[next++]) }, async dial => [
        await handshake(dial, version, {}, chainLength),
        await handshake(dial, version, {}, chainLength),
      ]);
      assert.deepStrictEqual(sent, [3, 2]);
    });

    // The context has agent6 alone. The two certificates above it are in the CA of the server.
    test("a certificate from an ALPNCallback gets its issuers from the CA of the server", async () => {
      const [certificate] = pem("agent6-cert.pem")
        .toString()
        .split(/(?<=-----END CERTIFICATE-----)/);
      const alone = tls.createSecureContext({ key: pem("agent6-key.pem"), cert: certificate });
      const options = { ...own, ca: [pem("ca3-cert.pem"), pem("ca1-cert.pem")], ALPNCallback: selects(alone) };
      assert.strictEqual(await serve(emit, options, dial => handshake(dial, version, {}, chainLength)), 3);
    });
  });
}

describe("what setKeyCert() puts on the connection, TLSv1.2 only", () => {
  test("the cipher suites of the context do not apply", async () => {
    const aes256 = tls.createSecureContext({ ...identity("agent1"), ciphers: "ECDHE-RSA-AES256-GCM-SHA384" });
    const options = { ...own, ciphers: "ECDHE-RSA-AES128-GCM-SHA256", SNICallback: applies(aes256) };
    const got = await serve(emit, options, dial =>
      handshake(dial, "TLSv1.2", {}, client => ({
        cn: client.getPeerCertificate().subject.CN,
        cipher: client.getCipher().name,
      })),
    );
    assert.deepStrictEqual(got, { cn: "agent1", cipher: "ECDHE-RSA-AES128-GCM-SHA256" });
  });

  // With this cipher suite the client encrypts to the key of the certificate that it got.
  test("an RSA key exchange uses the key that an ALPNCallback set", async () => {
    const options = { ...own, ciphers: "AES128-GCM-SHA256", ALPNCallback: selects(other) };
    const got = await serve(emit, options, dial =>
      handshake(dial, "TLSv1.2", { ciphers: "AES128-GCM-SHA256" }, client => ({
        ...served(client),
        cipher: client.getCipher().name,
      })),
    );
    assert.deepStrictEqual(got, { cn: "agent1", alpn: "h2", cipher: "AES128-GCM-SHA256" });
  });

  // The server's own context names ca1.
  const requests = { ...own, ca: pem("ca1-cert.pem"), requestCert: true, rejectUnauthorized: false };
  const naming = (ca: string) => tls.createSecureContext({ ...own, ca: pem(`${ca}-cert.pem`) });

  test("the request for a client certificate names the CA of the context", async () => {
    const options = { ...requests, SNICallback: applies(naming("ca2")) };
    assert.deepStrictEqual(await serve(emit, options, namedCAs), { ca1: false, ca2: true, ca3: false });
  });

  test("the request for a client certificate names no CA for a context without one", async () => {
    const options = { ...requests, SNICallback: applies(tls.createSecureContext(own)) };
    assert.deepStrictEqual(await serve(emit, options, namedCAs), { ca1: false, ca2: false, ca3: false });
  });

  for (const [when, give] of [Object.entries(answers)[0], Object.entries(answers)[2]]) {
    test(`the request names the CA of a context in the answer, when the answer comes ${when}`, async () => {
      const secureContext = tls.createSecureContext({ ...own, ca: pem("ca1-cert.pem") });
      const named: Record<string, unknown> = {};
      for (const [which, context] of Object.entries({
        "another context": naming("ca3"),
        "the server's own": secureContext,
      })) {
        const SNICallback: SNICallback = function (_, answer) {
          this.setKeyCert(naming("ca2"));
          give(answer, context);
        };
        const options = { secureContext, requestCert: true, rejectUnauthorized: false, SNICallback };
        named[which] = await serve(wrap, options, namedCAs);
      }
      assert.deepStrictEqual(named, {
        "another context": { ca1: false, ca2: false, ca3: true },
        "the server's own": { ca1: true, ca2: false, ca3: false },
      });
    });
  }

  // Its CA comes back too: the server's own context trusts ca1, which issued agent1.
  test("the server's own context in the answer verifies the client certificate again", async () => {
    const secureContext = tls.createSecureContext({ ...own, ca: pem("ca1-cert.pem") });
    const trustsCa2 = tls.createSecureContext({ ...identity("agent1"), ca: pem("ca2-cert.pem") });
    const verdict = Promise.withResolvers<string>();
    const SNICallback: SNICallback = function (_, answer) {
      this.setKeyCert(trustsCa2);
      answer(null, secureContext);
    };
    const got = await serve(
      emit,
      { secureContext, requestCert: true, rejectUnauthorized: false, SNICallback },
      dial => handshake(dial, "TLSv1.2", identity("agent1"), () => verdict.promise),
      { onSecure: socket => verdict.resolve(socket.authorized ? "authorized" : String(socket.authorizationError)) },
    );
    assert.strictEqual(got, "authorized");
  });
});

// Bun differs from Node.js in these. Each test states both results.
for (const version of versions) {
  describe(`where setKeyCert() differs from Node.js, ${version}`, () => {
    // Bun keeps the sessions of two contexts apart, as it does for the contexts that SNI selects.
    test("a session is resumed only under the context that issued it", async () => {
      const contexts: Record<string, tls.SecureContext> = { "a.test": other, "b.test": third };
      const SNICallback: SNICallback = function (servername, answer) {
        this.setKeyCert(contexts[servername]);
        answer(null);
      };
      // BoringSSL holds the session tickets of TLS 1.3 back until the server writes.
      const reused = await serve(
        emit,
        { ...own, SNICallback },
        async dial => {
          const session = await handshake(dial, version, {}, (_, issued) => issued);
          const resumes = (servername: string) =>
            handshake(dial, version, { servername, session }, client => client.isSessionReused());
          return { "a.test": await resumes("a.test"), "b.test": await resumes("b.test") };
        },
        { onSecure: socket => socket.end("x") },
      );
      assert.deepStrictEqual(reused, { "a.test": true, "b.test": !onBun });
    });

    // OpenSSL picks the certificate after the ALPNCallback, and BoringSSL before it. Bun replaces the certificate when
    // the new key fits what the handshake picked for the old one, and leaves it otherwise.
    for (const [which, from, to, bun, node] of [
      [
        "on another curve",
        identity("ec10"),
        { key: "p521-key.pem", cert: "p521-cert.pem" },
        "agent10.example.com",
        "p521-localhost",
      ],
      [
        "of another type, for a client that prefers it",
        own,
        { key: "ec10-key.pem", cert: "ec10-cert.pem" },
        "agent2",
        version === "TLSv1.3" ? "agent10.example.com" : "agent2",
      ],
    ] as const) {
      test(`a key ${which} in an ALPNCallback`, async () => {
        const dir = to.key.startsWith("p521") ? fixtures : keys;
        const context = tls.createSecureContext({
          key: readFileSync(join(dir, to.key)),
          cert: readFileSync(join(dir, to.cert)),
        });
        const got = await serve(emit, { ...from, ALPNCallback: selects(context) }, dial => handshake(dial, version));
        assert.deepStrictEqual(got, { cn: onBun ? bun : node, alpn: "h2" });
      });
    }

    // The key of agent11 has 512 bits, which Node.js refuses in a context. It is too short for the signature that
    // the handshake picked for the key of agent2.
    (onBun ? test : test.skip)("a shorter RSA key in an ALPNCallback leaves the certificate", async () => {
      const context = tls.createSecureContext(identity("agent11"));
      const got = await serve(emit, { ...own, ALPNCallback: selects(context) }, dial => handshake(dial, version));
      assert.deepStrictEqual(got, { cn: "agent2", alpn: "h2" });
    });

    // With an RSA key exchange the client encrypts to the certificate that it got, and no other key can read that.
    for (const ciphers of version === "TLSv1.2" ? [undefined, "AES128-GCM-SHA256"] : [undefined]) {
      test(`a call after the answer, when the server's flight is out${ciphers ? ", RSA key exchange" : ""}`, async () => {
        const SNICallback: SNICallback = function (_, answer) {
          answer(null);
          queueMicrotask(() => this.setKeyCert(other));
        };
        const options = { ...own, ...(ciphers && { ciphers }), SNICallback, ALPNProtocols: ["h2"] };
        const got = await serve(emit, options, dial => handshake(dial, version, ciphers ? { ciphers } : {}));
        assert.deepStrictEqual(got, { cn: onBun ? "agent2" : "agent1", alpn: "h2" });
      });
    }

    // Bun takes the answer when the SNICallback returns.
    test("a call after an answer with a context, in the SNICallback", async () => {
      const SNICallback: SNICallback = function (_, answer) {
        answer(null, third);
        this.setKeyCert(other);
      };
      const got = await serve(emit, { ...own, SNICallback, ALPNProtocols: ["h2"] }, dial => handshake(dial, version));
      assert.deepStrictEqual(got, { cn: onBun ? "agent3" : "agent1", alpn: "h2" });
    });

    // On TLS 1.3 Node.js runs the ALPNCallback before the SNICallback, and Bun after it. The last call wins.
    for (const [which, SNICallback] of [
      ["answered", ((_, answer) => answer(null, third)) as SNICallback],
      ["set", applies(third)],
    ] as const) {
      for (const [door, open] of Object.entries(doors)) {
        test(`setKeyCert() in an ALPNCallback, after the SNICallback ${which} a context, ${door}`, async () => {
          const options = { ...own, SNICallback, ALPNCallback: selects(other) };
          const got = await serve(open, options, dial => handshake(dial, version));
          assert.deepStrictEqual(got, { cn: version === "TLSv1.3" && !onBun ? "agent3" : "agent1", alpn: "h2" });
        });
      }
    }

    test("setKeyCert() in an ALPNCallback, for a name of addContext()", async () => {
      const server = tls.createServer({ ...own, ALPNCallback: selects(other) }, socket => socket.on("error", () => {}));
      server.addContext("a.test", identity("agent3"));
      try {
        const got = await handshake(await listen(server), version);
        assert.deepStrictEqual(got, { cn: version === "TLSv1.3" && !onBun ? "agent3" : "agent1", alpn: "h2" });
      } finally {
        server.close();
      }
    });

    // Here agent6 comes alone, and the two certificates above it are the `ca` of the context. Bun sends them, as a
    // server with that context does.
    test("the issuers that the context has as its CA", async () => {
      const [certificate] = pem("agent6-cert.pem")
        .toString()
        .split(/(?<=-----END CERTIFICATE-----)/);
      const context = tls.createSecureContext({
        key: pem("agent6-key.pem"),
        cert: certificate,
        ca: [pem("ca3-cert.pem"), pem("ca1-cert.pem")],
      });
      const options = { ...own, SNICallback: applies(context) };
      assert.strictEqual(await serve(emit, options, dial => handshake(dial, version, {}, chainLength)), onBun ? 3 : 1);
    });

    // Node.js copies one certificate and one key, and leaves the server's certificates of other key types. Bun
    // replaces every certificate of the connection with every one of the context.
    describe("certificates of two key types", () => {
      const rsa = identity("agent1");
      const ecdsa = identity("ec10");
      const both = (first: { key: Buffer; cert: Buffer }) => ({
        key: [first.key, ecdsa.key],
        cert: [first.cert, ecdsa.cert],
      });
      const toEach = async (options: tls.TlsOptions) =>
        serve(emit, { ...options, ALPNProtocols: ["h2"] }, async dial => ({
          "RSA only": await handshake(dial, version, only("RSA", version), c => served(c).cn).catch(refused),
          "ECDSA only": await handshake(dial, version, only("ECDSA", version), c => served(c).cn).catch(refused),
        }));

      test("in the context", async () => {
        const context = tls.createSecureContext(both(rsa));
        assert.deepStrictEqual(await toEach({ ...identity("agent3"), SNICallback: applies(context) }), {
          "RSA only": onBun ? "agent1" : "agent3",
          "ECDSA only": "agent10.example.com",
        });
      });

      test("in the server", async () => {
        assert.deepStrictEqual(await toEach({ ...both(identity("agent3")), SNICallback: applies(other) }), {
          "RSA only": "agent1",
          "ECDSA only": onBun ? "refused" : "agent10.example.com",
        });
      });

      test("in the context of the first of two calls", async () => {
        const context = tls.createSecureContext(both(rsa));
        const SNICallback: SNICallback = function (_, answer) {
          this.setKeyCert(context);
          this.setKeyCert(third);
          answer(null);
        };
        assert.deepStrictEqual(await toEach({ ...own, SNICallback }), {
          "RSA only": "agent3",
          "ECDSA only": onBun ? "refused" : "agent10.example.com",
        });
      });

      test("an ECDSA and an Ed25519 one in the context", async () => {
        const ed25519 = (part: string) => readFileSync(join(fixtures, `ed25519-${part}.pem`));
        const context = tls.createSecureContext({
          key: [ecdsa.key, ed25519("key")],
          cert: [ecdsa.cert, ed25519("cert")],
        });
        const got = await serve(emit, { ...own, SNICallback: applies(context) }, async dial => ({
          "Ed25519 only": await handshake(dial, version, { sigalgs: "ed25519" }, c => served(c).cn).catch(refused),
          "ECDSA only": await handshake(dial, version, { sigalgs: "ecdsa_secp256r1_sha256" }, c => served(c).cn).catch(
            refused,
          ),
        }));
        assert.deepStrictEqual(got, {
          "Ed25519 only": "ed25519-localhost",
          "ECDSA only": onBun ? "agent10.example.com" : "refused",
        });
      });

      // The connections of such a server sign with one object for each key type, and Bun leaves that as it is.
      test("in the server, for a call in an ALPNCallback", async () => {
        const options = { ...both(identity("agent3")), ALPNCallback: selects(other) };
        const got = await serve(emit, options, dial => handshake(dial, version, only("RSA", version)));
        assert.deepStrictEqual(got, { cn: onBun ? "agent3" : "agent1", alpn: "h2" });
      });
    });

    // After the call the cipher suites and the signature algorithms are still the server's. Node.js also still has
    // the server's RSA certificate for them.
    test("a server that allows RSA only, and a context with an ECDSA certificate", async () => {
      const policy =
        version === "TLSv1.2" ? { ciphers: "ECDHE-RSA-AES128-GCM-SHA256" } : { sigalgs: "rsa_pss_rsae_sha256" };
      const options = { ...own, ...policy, SNICallback: applies(tls.createSecureContext(identity("ec10"))) };
      const got = await serve(emit, options, dial =>
        handshake(dial, version, {}, client => served(client).cn).catch(refused),
      );
      assert.strictEqual(got, onBun ? "refused" : "agent2");
    });

    // Node.js takes the certificate and then fails on the key, which leaves the connection without a certificate.
    test("a context with a certificate and no key", async () => {
      const context = tls.createSecureContext({ cert: pem("agent1-cert.pem") });
      let thrown: unknown;
      const SNICallback: SNICallback = function (_, answer) {
        try {
          this.setKeyCert(context);
        } catch (err) {
          thrown = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
        }
        answer(null);
      };
      const got = await serve(emit, { ...own, SNICallback }, dial =>
        handshake(dial, version, {}, client => served(client).cn).catch(refused),
      );
      assert.deepStrictEqual(
        { got, thrown },
        onBun ? { got: "agent2", thrown: "SetKeyCert" } : { got: "refused", thrown: "ERR_SSL_PASSED_A_NULL_PARAMETER" },
      );
    });

    // Bun gives the socket its connection after the constructor returns, and a call before that does nothing.
    test("a call right after new TLSSocket()", async () => {
      const front = net.createServer(raw => {
        const socket = new tls.TLSSocket(raw, { ...own, isServer: true, ALPNProtocols: ["h2"] });
        socket.on("error", () => {});
        socket.setKeyCert(other);
      });
      try {
        const got = await handshake(await listen(front), version);
        assert.deepStrictEqual(got, { cn: onBun ? "agent2" : "agent1", alpn: "h2" });
      } finally {
        front.close();
      }
    });

    // Node.js ignores the call on a client socket. Bun applies it: the certificate that the client sends, and the CA
    // that it verifies the server with.
    test("a client socket", async () => {
      const seen = Promise.withResolvers<unknown>();
      const got = await serve(
        emit,
        { ...own, requestCert: true, rejectUnauthorized: false },
        async dial => {
          const client = tls.connect({
            ...dial,
            ...identity("agent1"),
            rejectUnauthorized: false,
            minVersion: version,
            maxVersion: version,
          });
          client.on("error", seen.reject);
          client.on("connect", () => client.setKeyCert(third));
          try {
            return await seen.promise;
          } finally {
            client.destroy();
          }
        },
        { onSecure: socket => seen.resolve(socket.getPeerCertificate().subject?.CN) },
      );
      assert.strictEqual(got, onBun ? "agent3" : "agent1");
    });

    // The client keeps its own certificate then, and verifies the server with the CA of the context.
    test("a client socket, and a context that has a CA only", async () => {
      const trustsCa2 = tls.createSecureContext({ ca: pem("ca2-cert.pem") });
      const sent = Promise.withResolvers<unknown>();
      const got = await serve(
        emit,
        { ...identity("agent1"), requestCert: true, rejectUnauthorized: false },
        async dial => {
          const client = tls.connect({
            ...dial,
            ...identity("agent3"),
            ca: pem("ca1-cert.pem"),
            checkServerIdentity: () => undefined,
            rejectUnauthorized: false,
            minVersion: version,
            maxVersion: version,
          });
          client.on("connect", () => client.setKeyCert(trustsCa2));
          try {
            await once(client, "secureConnect");
            return { authorized: client.authorized, sent: await sent.promise };
          } finally {
            client.destroy();
          }
        },
        { onSecure: socket => sent.resolve(socket.getPeerCertificate().subject?.CN) },
      );
      assert.deepStrictEqual(got, { authorized: !onBun, sent: "agent3" });
    });
  });
}

// Only in Bun: when Node.js runs this file it must not spawn itself again. Node.js takes a .ts file from 22.18 and 23.6.
if (onBun) {
  const node = Bun.which("node");
  const version = node
    ? Bun.spawnSync({ cmd: [node, "-p", "process.versions.node"] })
        .stdout.toString()
        .trim()
    : "";
  const takesTypeScript = Bun.semver.satisfies(version, ">=22.18.0 <23.0.0 || >=23.6.0");
  describe("Node.js compatibility", () => {
    (takesTypeScript ? test : test.skip)("all tests pass in Node.js", { timeout: 120_000 }, async () => {
      await using proc = Bun.spawn({
        // A test that hangs in Node.js fails by name instead of running this one out of time.
        cmd: [node!, "--test-timeout=15000", "--test-force-exit", import.meta.filename],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
