import { tls as ipSanCert } from "harness";
import assert from "node:assert";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";

// Server presents a cert for CN=agent1 (no SAN), signed by ca1.
// A client connecting to host "localhost" with ca1 trusted will pass chain
// verification but MUST fail hostname verification (localhost != agent1).
const fixturesDir = path.join(import.meta.dirname, "fixtures");
const serverKey = fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"));
const serverCert = fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"));
const ca = fs.readFileSync(path.join(fixturesDir, "ca1-cert.pem"));

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = tls.createServer({ key: serverKey, cert: serverCert }, c => c.end());
  server.listen(0);
  await once(server, "listening");
  try {
    return await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
}

describe("tls.connect hostname verification without explicit servername", () => {
  test("rejects an IP address as options.servername", () => {
    assert.throws(() => tls.connect({ host: "localhost", port: 1, servername: "127.0.0.1" }), {
      code: "ERR_INVALID_ARG_VALUE",
    });
    assert.throws(() => tls.connect({ host: "localhost", port: 1, servername: "::1" }), {
      code: "ERR_INVALID_ARG_VALUE",
    });
  });

  test("rejects a CA-trusted cert whose CN does not match host", async () => {
    await withServer(async port => {
      const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
      const socket = tls.connect({ host: "localhost", port, ca }, () => {
        socket.destroy();
        reject(
          Object.assign(new Error("secureConnect fired without rejecting mismatched hostname"), {
            authorized: socket.authorized,
            authorizationError: socket.authorizationError,
          }),
        );
      });
      socket.on("error", err => {
        socket.destroy();
        resolve(err as NodeJS.ErrnoException);
      });
      const err = await promise;
      assert.strictEqual(err.code, "ERR_TLS_CERT_ALTNAME_INVALID");
    });
  });

  test("reports authorized=false on hostname mismatch with rejectUnauthorized=false", async () => {
    await withServer(async port => {
      const { promise, resolve, reject } = Promise.withResolvers<{ authorized: boolean; authorizationError: string }>();
      const socket = tls.connect({ host: "localhost", port, ca, rejectUnauthorized: false });
      socket.on("secureConnect", () => {
        resolve({
          authorized: socket.authorized,
          authorizationError: String(socket.authorizationError),
        });
        socket.destroy();
      });
      socket.on("error", err => {
        socket.destroy();
        reject(err);
      });
      const result = await promise;
      assert.strictEqual(result.authorized, false);
      assert.match(result.authorizationError, /ERR_TLS_CERT_ALTNAME_INVALID/);
    });
  });

  test("invokes checkServerIdentity with host when servername is omitted", async () => {
    await withServer(async port => {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      let calledWith: string | undefined;
      const socket = tls.connect({
        host: "localhost",
        port,
        ca,
        rejectUnauthorized: false,
        checkServerIdentity(hostname, cert) {
          calledWith = hostname;
          return tls.checkServerIdentity(hostname, cert);
        },
      });
      socket.on("secureConnect", () => {
        socket.destroy();
        if (calledWith === undefined) reject(new Error("checkServerIdentity was never called"));
        else resolve(calledWith);
      });
      socket.on("error", err => {
        socket.destroy();
        reject(err);
      });
      assert.strictEqual(await promise, "localhost");
    });
  });
});

const localhostOnlyKey = fs.readFileSync(path.join(fixturesDir, "rsa_private.pem"));
const localhostOnlyCert = fs.readFileSync(path.join(fixturesDir, "rsa_cert.crt"));

async function withRawSocketTo(
  serverOptions: tls.TlsOptions,
  fn: (raw: net.Socket, port: number) => Promise<void>,
): Promise<void> {
  const server = tls.createServer(serverOptions, c => {
    c.on("error", () => {});
    c.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as AddressInfo).port;
    const raw = net.connect(port, "127.0.0.1");
    raw.on("error", () => {});
    await once(raw, "connect");
    try {
      await fn(raw, port);
    } finally {
      raw.destroy();
    }
  } finally {
    server.close();
  }
}

describe("tls.connect over an existing socket verifies the certificate against options.host", () => {
  test("passes the IP from options.host to checkServerIdentity", async () => {
    await withRawSocketTo({ key: ipSanCert.key, cert: ipSanCert.cert }, async raw => {
      const { promise, resolve, reject } = Promise.withResolvers<{
        calledWith: string | undefined;
        authorized: boolean;
      }>();
      let calledWith: string | undefined;
      const socket = tls.connect({
        socket: raw,
        host: "127.0.0.1",
        ca: ipSanCert.cert,
        checkServerIdentity(hostname, cert) {
          calledWith = hostname;
          return tls.checkServerIdentity(hostname, cert);
        },
      });
      socket.on("secureConnect", () => {
        resolve({ calledWith, authorized: socket.authorized });
        socket.destroy();
      });
      socket.on("error", err => {
        socket.destroy();
        reject(err);
      });
      const result = await promise;
      assert.deepStrictEqual(result, { calledWith: "127.0.0.1", authorized: true });
    });
  });

  test("rejects a certificate that is only valid for localhost when options.host is an IP", async () => {
    await withRawSocketTo({ key: localhostOnlyKey, cert: localhostOnlyCert }, async raw => {
      const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
      const socket = tls.connect({ socket: raw, host: "127.0.0.1", ca: localhostOnlyCert }, () => {
        const detail = { authorized: socket.authorized, authorizationError: socket.authorizationError };
        socket.destroy();
        reject(Object.assign(new Error("secureConnect fired for a certificate that does not cover the IP"), detail));
      });
      socket.on("error", err => {
        socket.destroy();
        resolve(err as NodeJS.ErrnoException);
      });
      const err = await promise;
      assert.strictEqual(err.code, "ERR_TLS_CERT_ALTNAME_INVALID");
      assert.strictEqual(
        err.message,
        "Hostname/IP does not match certificate's altnames: IP: 127.0.0.1 is not in the cert's list: ",
      );
    });
  });

  test("reports authorized=false for a localhost-only certificate when options.host is an IP and rejectUnauthorized=false", async () => {
    await withRawSocketTo({ key: localhostOnlyKey, cert: localhostOnlyCert }, async raw => {
      const { promise, resolve, reject } = Promise.withResolvers<{
        authorized: boolean;
        authorizationError: unknown;
      }>();
      const socket = tls.connect({ socket: raw, host: "127.0.0.1", ca: localhostOnlyCert, rejectUnauthorized: false });
      socket.on("secureConnect", () => {
        resolve({ authorized: socket.authorized, authorizationError: socket.authorizationError });
        socket.destroy();
      });
      socket.on("error", err => {
        socket.destroy();
        reject(err);
      });
      assert.deepStrictEqual(await promise, { authorized: false, authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID" });
    });
  });
});

// Adds a pin and a callback that records its `this` to the caller's options.
function pinned<T extends object>(callerOptions: T) {
  let receiver: any;
  let calls = 0;
  const options = Object.assign(callerOptions, {
    pin: "agent1",
    checkServerIdentity(this: unknown) {
      calls++;
      receiver = this;
      return undefined;
    },
  });
  const seen = () => ({
    calls,
    pin: receiver?.pin,
    host: receiver?.host,
    ownsCallback: receiver?.checkServerIdentity === options.checkServerIdentity,
    isCallerObject: receiver === options,
  });
  return { options, seen, receiver: () => receiver };
}

async function secureConnect(socket: tls.TLSSocket) {
  try {
    await once(socket, "secureConnect");
  } finally {
    socket.destroy();
  }
}

function outcomeOf(socket: tls.TLSSocket) {
  const { promise, resolve } = Promise.withResolvers<string>();
  socket.on("secureConnect", () => resolve(`secureConnect, authorized=${socket.authorized}`));
  socket.on("error", error => resolve(`error: ${error.message}`));
  return promise.finally(() => socket.destroy());
}

// What `seen()` gives when `this` is the copy of the caller's options that tls.connect() builds.
const connectOptions = (host: string) => ({
  calls: 1,
  pin: "agent1",
  host,
  ownsCallback: true,
  isCallerObject: false,
});

// Node calls the callback as a method of the options object that tls.connect()
// builds: its defaults, then a copy of the caller's own properties. https and
// http2 clients get their socket from tls.connect().
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1671
describe("checkServerIdentity is called with the connect options as `this`", () => {
  test("tls.connect(options) to an IP address", async () => {
    await withServer(async port => {
      const { options, seen } = pinned({ ca, host: "127.0.0.1", port });
      await secureConnect(tls.connect(options));
      assert.deepStrictEqual(seen(), connectOptions("127.0.0.1"));
    });
  });

  test("tls.connect(options) to a hostname", async () => {
    await withServer(async port => {
      const { options, seen } = pinned({ ca, host: "localhost", port });
      await secureConnect(tls.connect(options));
      assert.deepStrictEqual(seen(), connectOptions("localhost"));
    });
  });

  test("tls.connect({ socket })", async () => {
    await withRawSocketTo({ key: serverKey, cert: serverCert }, async raw => {
      const { options, seen } = pinned({ ca, socket: raw, host: "agent1" });
      await secureConnect(tls.connect(options));
      assert.deepStrictEqual(seen(), connectOptions("agent1"));
    });
  });

  test("https.request(options)", async () => {
    const server = https.createServer({ key: serverKey, cert: serverCert }, (_req, res) => res.end("ok"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { options, seen } = pinned({ ca, host: "127.0.0.1", port: (server.address() as AddressInfo).port });
      const [res] = await once(https.request(options).end(), "response");
      res.resume();
      await once(res, "end");
      assert.deepStrictEqual(seen(), connectOptions("127.0.0.1"));
    } finally {
      server.close();
      server.closeAllConnections();
    }
  });

  test("http2.connect(authority, options)", async () => {
    const server = http2.createSecureServer({ key: serverKey, cert: serverCert });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { options, seen } = pinned({ ca });
      const session = http2.connect(`https://127.0.0.1:${(server.address() as AddressInfo).port}`, options);
      try {
        await once(session, "connect");
      } finally {
        session.destroy();
      }
      assert.deepStrictEqual(seen(), connectOptions("127.0.0.1"));
    } finally {
      server.close();
    }
  });

  test("a callback that is a method can compare the certificate with `this.pin`", async () => {
    const { fingerprint256 } = new X509Certificate(serverCert);
    await withServer(async port => {
      const connect = (pin: string) =>
        tls.connect({
          host: "127.0.0.1",
          port,
          ca,
          pin,
          checkServerIdentity(this: { pin: string }, _hostname: string, cert: tls.PeerCertificate) {
            return cert.fingerprint256 === this.pin ? undefined : new Error("pin mismatch");
          },
        } as tls.ConnectionOptions);
      assert.strictEqual(await outcomeOf(connect(fingerprint256)), "secureConnect, authorized=true");
      assert.strictEqual(await outcomeOf(connect("not the fingerprint of agent1")), "error: pin mismatch");
    });
  });

  // Sloppy mode turns a missing `this` into globalThis. A callback that guards
  // on `this.pin` then skips its check and accepts every certificate.
  test("a sloppy mode callback that guards on `this.pin` refuses a wrong pin", async () => {
    // The Function constructor makes a sloppy mode function in this strict mode module.
    const checkServerIdentity = new Function(
      "hostname",
      "cert",
      `if (this.pin && cert.subject.CN !== this.pin) return new Error("pin mismatch");`,
    ) as typeof tls.checkServerIdentity;
    await withServer(async port => {
      const connect = (pin: string) =>
        tls.connect({ host: "127.0.0.1", port, ca, pin, checkServerIdentity } as tls.ConnectionOptions);
      assert.strictEqual(await outcomeOf(connect("agent1")), "secureConnect, authorized=true");
      assert.strictEqual(await outcomeOf(connect("agent2")), "error: pin mismatch");
    });
  });

  // Node does not run the callback for a resumed session. Bun does.
  test("tls.connect(options) that resumes a session", async () => {
    const server = tls.createServer({ key: serverKey, cert: serverCert, maxVersion: "TLSv1.2" }, c => c.end());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as AddressInfo;
      const first = tls.connect({ host: "127.0.0.1", port, ca, servername: "agent1" });
      const [session] = await once(first, "session");
      first.destroy();

      const { options, seen } = pinned({ host: "127.0.0.1", port, ca, servername: "agent1", session });
      const resumed = tls.connect(options);
      try {
        await once(resumed, "secureConnect");
        assert.deepStrictEqual(
          { ...seen(), isSessionReused: resumed.isSessionReused() },
          { ...connectOptions("127.0.0.1"), isSessionReused: true },
        );
      } finally {
        resumed.destroy();
      }
    } finally {
      server.close();
    }
  });
});

// Node runs the identity check only for a socket from tls.connect(), whose
// options always own the callback. Bun also runs it after TLSSocket#connect().
// There the callback can come from the constructor options, which Bun did not
// keep. The options of connect() are then not its `this`.
describe("checkServerIdentity after TLSSocket#connect()", () => {
  test("`this` is undefined when the constructor options own the callback", async () => {
    await withServer(async port => {
      for (const ownKeys of [{}, { checkServerIdentity: undefined }]) {
        const { options, seen, receiver } = pinned({ ca });
        // @ts-expect-error @types/node requires a socket
        const socket = new tls.TLSSocket(undefined, options);
        socket.connect({ host: "127.0.0.1", port, ...ownKeys });
        await secureConnect(socket);
        assert.deepStrictEqual({ calls: seen().calls, receiver: receiver() }, { calls: 1, receiver: undefined });
      }
    });
  });

  test("`this` is the options of connect() when they own the callback", async () => {
    await withServer(async port => {
      const { options, seen } = pinned({ host: "127.0.0.1", port });
      // @ts-expect-error @types/node requires a socket
      const socket = new tls.TLSSocket(undefined, { ca });
      socket.connect(options);
      await secureConnect(socket);
      assert.deepStrictEqual(seen(), { ...connectOptions("127.0.0.1"), isCallerObject: true });
    });
  });
});

const escapingDir = path.join(import.meta.dirname, "..", "test", "fixtures", "x509-escaping");
const escapingKey = fs.readFileSync(path.join(escapingDir, "server-key.pem"));

async function altnameMismatchReason(certFile: string): Promise<NodeJS.ErrnoException | null> {
  const cert = fs.readFileSync(path.join(escapingDir, certFile));
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls: { key: escapingKey, cert },
    socket: {
      open() {},
      data() {},
      drain() {},
      close() {},
      error() {},
    },
  });
  try {
    const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException | null>();
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: listener.port,
      tls: { ca: cert, serverName: "evil.example.com" },
      socket: {
        open() {},
        handshake(s) {
          resolve(s.getAuthorizationError());
          s.end();
        },
        data() {},
        drain() {},
        close() {},
        error(_s, err) {
          reject(err);
        },
        connectError(_s, err) {
          reject(err);
        },
      },
    });
    try {
      return await promise;
    } finally {
      socket.end();
    }
  } finally {
    listener.stop(true);
  }
}

describe("Bun.connect TLS altname mismatch reason", () => {
  test("quotes and escapes a DNS altname containing a comma", async () => {
    const error = await altnameMismatchReason("alt-0-cert.pem");
    assert.ok(error, "getAuthorizationError() must report why the socket is not authorized");
    assert.strictEqual(
      error.message,
      `Hostname/IP does not match certificate's altnames: Host: evil.example.com. is not in the cert's altnames: DNS:"good.example.com\\u002c DNS:evil.example.com"`,
    );
    assert.strictEqual(error.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  });

  test("quotes and escapes a DNS altname containing double quotes", async () => {
    const error = await altnameMismatchReason("alt-7-cert.pem");
    assert.ok(error, "getAuthorizationError() must report why the socket is not authorized");
    assert.strictEqual(
      error.message,
      `Hostname/IP does not match certificate's altnames: Host: evil.example.com. is not in the cert's altnames: DNS:"\\"evil.example.com\\""`,
    );
    assert.strictEqual(error.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  });

  test("quotes and escapes a DNS altname containing a non-ASCII byte", async () => {
    const error = await altnameMismatchReason("alt-6-cert.pem");
    assert.ok(error, "getAuthorizationError() must report why the socket is not authorized");
    assert.strictEqual(
      error.message,
      `Hostname/IP does not match certificate's altnames: Host: evil.example.com. is not in the cert's altnames: DNS:"ex\\u00e4mple.com"`,
    );
    assert.strictEqual(error.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  });
});

describe("Bun.connect TLS hostname verification", () => {
  // The server presents the agent1 cert (CN=agent1, no SAN) signed by ca1.
  // A client that trusts ca1 and connects to "localhost" passes chain
  // validation, but the certificate is not valid for "localhost", so the
  // socket must not be reported as authorized.
  //
  // Bind the listener to 127.0.0.1 rather than "localhost": Bun.listen
  // resolves the bind host without AI_ADDRCONFIG while Bun.connect resolves
  // with it, so on a host whose only IPv6 address is loopback the listener
  // can end up on ::1 while the client dials 127.0.0.1 and gets ECONNREFUSED
  // (Node's net.connect behaves the same way).
  test("reports authorized=false when a CA-trusted cert does not match the connected hostname", async () => {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: serverKey, cert: serverCert },
      socket: {
        open() {},
        data() {},
        drain() {},
        close() {},
        error() {},
      },
    });
    try {
      // Mismatch: connect host "localhost" vs cert CN "agent1".
      const mismatch = Promise.withResolvers<{ flag: boolean; arg: boolean; error: NodeJS.ErrnoException | null }>();
      const badSocket = await Bun.connect({
        hostname: "localhost",
        port: listener.port,
        tls: { ca },
        socket: {
          open() {},
          handshake(s, success) {
            mismatch.resolve({ flag: s.authorized, arg: success, error: s.getAuthorizationError() });
            s.end();
          },
          data() {},
          drain() {},
          close() {},
          error(_s, err) {
            mismatch.reject(err);
          },
          connectError(_s, err) {
            mismatch.reject(err);
          },
        },
      });
      const result = await mismatch.promise;
      badSocket.end();
      assert.strictEqual(result.arg, false, "handshake callback must not report success for a hostname mismatch");
      assert.strictEqual(result.flag, false, "socket.authorized must be false for a hostname mismatch");
      assert.ok(result.error, "getAuthorizationError() must report why the socket is not authorized");
      assert.strictEqual(result.error.code, "ERR_TLS_CERT_ALTNAME_INVALID");

      // Legitimate case: same cert, but the client asks for server name
      // "agent1", which matches the certificate. Must remain authorized.
      const match = Promise.withResolvers<boolean>();
      const goodSocket = await Bun.connect({
        hostname: "localhost",
        port: listener.port,
        tls: { ca, serverName: "agent1" },
        socket: {
          open() {},
          handshake(s) {
            match.resolve(s.authorized);
            s.end();
          },
          data() {},
          drain() {},
          close() {},
          error(_s, err) {
            match.reject(err);
          },
          connectError(_s, err) {
            match.reject(err);
          },
        },
      });
      const okAuthorized = await match.promise;
      goodSocket.end();
      assert.strictEqual(okAuthorized, true, "a certificate matching the requested server name must stay authorized");
    } finally {
      listener.stop(true);
    }
  });
});
