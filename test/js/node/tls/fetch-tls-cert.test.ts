import { expect, it } from "bun:test";
import { readFileSync } from "fs";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { join } from "path";

type Certs = { key: string; cert: string; ca: string; single: string; subca: string };
const client = {
  key: readFileSync(join(import.meta.dir, "fixtures", "ec10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "ec10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca5-cert.pem"), "utf8"),
} as Certs;
const server = {
  key: readFileSync(join(import.meta.dir, "fixtures", "agent10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "agent10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca2-cert.pem"), "utf8"),
} as Certs;

function split(file: any, into: any) {
  const certs = /([^]*END CERTIFICATE-----\r?\n)(-----BEGIN[^]*)/.exec(file) as RegExpExecArray;
  into.single = certs[1];
  into.subca = certs[2];
}

// Split out the single end-entity cert and the subordinate CA for later use.
split(client.cert, client);
split(server.cert, server);

// The certificates aren't for "localhost", so override the identity check.
function checkServerIdentity(hostname: string, cert: any): undefined {
  expect(hostname).toBe("localhost");
  expect(cert.subject.CN).toBe("agent10.example.com");
}

async function connect(options: any) {
  {
    using server = Bun.serve({
      tls: options.server,
      port: 0,
      fetch(req) {
        return new Response("Hello World!");
      },
    });
    const port = server.port;
    const result = await fetch(`https://localhost:${port}`, {
      tls: options.client,
    }).then(res => res.text());
    if (result !== "Hello World!") {
      throw new Error("Unexpected response from server");
    }
  }
}
it("complete cert chains sent to peer.", async () => {
  await connect({
    client: {
      key: client.key,
      cert: client.cert,
      ca: server.ca,
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.cert,
      ca: client.ca,
      requestCert: true,
    },
  });
});

// https://github.com/oven-sh/bun/issues/27985. TLS 1.3 usually coalesces the
// client's Certificate..Finished with its first request bytes; one attempt only
// caught this ~60% of the time, so 25 keeps P(a regression slips through) < 1e-9.
const REJECT_ATTEMPTS = 25;
it("rejects a client cert the server's CA cannot verify, every time", async () => {
  let served = 0;
  using srv = Bun.serve({
    port: 0,
    tls: {
      key: server.key,
      cert: server.cert,
      ca: server.ca,
      requestCert: true,
      rejectUnauthorized: true,
    },
    fetch() {
      served++;
      return new Response("MUST NOT BE SERVED");
    },
  });
  const clientTls = { key: client.key, cert: client.cert, ca: server.ca, checkServerIdentity };
  for (let i = 0; i < REJECT_ATTEMPTS; i++) {
    const outcome = await fetch(`https://localhost:${srv.port}`, { tls: clientTls }).then(
      res => `accepted with status ${res.status}`,
      err => err.code ?? String(err),
    );
    expect(outcome).toBe("ECONNRESET");
  }
  expect(served).toBe(0);
});

// Known gap: `ca` on a Bun.serve TLS server sets SSL_VERIFY_PEER|FAIL_IF_NO_PEER_CERT even
// without `requestCert`, so the server demands a client cert and aborts (ECONNRESET).
// Node only requests one when `requestCert: true`.
it.todo("complete cert chains sent to peer, but without requesting client's cert.", async () => {
  await connect({
    client: {
      ca: server.ca,
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.cert,
      ca: client.ca,
    },
  });
});

// Known gap: fetch reports this failed handshake as EPROTO. Node reports the alert the
// server sends, ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE.
it.todo("Request cert from TLS1.2 client that doesn't have one.", async () => {
  try {
    await connect({
      client: {
        maxVersion: "TLSv1.2",
        ca: server.ca,
        checkServerIdentity,
      },
      server: {
        key: server.key,
        cert: server.cert,
        ca: client.ca,
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
      key: client.key,
      cert: client.single,
      ca: [server.ca, server.subca],
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.single,
      ca: [client.ca, client.subca],
      requestCert: true,
    },
  });
});

it("Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer. But using multi-PEM", async () => {
  await connect({
    client: {
      key: client.key,
      cert: client.single,
      ca: server.ca + "\n" + server.subca,
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.single,
      ca: client.ca + "\n" + client.subca,
      requestCert: true,
    },
  });
});

it("Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer. But using multi-PEM in an array", async () => {
  await connect({
    client: {
      key: client.key,
      cert: client.single,
      ca: [server.ca + "\n" + server.subca],
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.single,
      ca: [client.ca + "\n" + client.subca],
      requestCert: true,
    },
  });
});

it("Fail to complete server's chain", async () => {
  try {
    await connect({
      client: {
        ca: server.ca,
        checkServerIdentity,
      },
      server: {
        key: server.key,
        cert: server.single,
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
        key: client.key,
        cert: client.single,
        ca: server.ca,
        checkServerIdentity,
      },
      server: {
        key: server.key,
        cert: server.cert,
        ca: client.ca,
        requestCert: true,
      },
    });
    expect.unreachable();
  } catch (err: any) {
    // The X.509 verify result (UNABLE_TO_GET_ISSUER_CERT) is the server's.
    // Node's server signals it with a TLS alert (its client sees an SSL alert
    // error); Bun's server aborts the connection, so the client sees a reset.
    expect(err.code).toBe("ECONNRESET");
  }
});

it("Fail to find CA for server.", async () => {
  try {
    await connect({
      client: {
        checkServerIdentity,
      },
      server: {
        key: server.key,
        cert: server.cert,
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
        key: server.key,
        cert: server.cert + "\n" + server.ca,
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
      ca: server.ca,
    },
    server: {
      key: server.key,
      cert: server.cert + "\n" + server.ca,
    },
  });
});

// Known gap: "BEGIN TRUSTED CERTIFICATE" PEM blocks aren't parsed as CA input, so
// the client cannot verify the server (UNABLE_TO_GET_ISSUER_CERT_LOCALLY).
it.todo('Confirm client support for "BEGIN TRUSTED CERTIFICATE".', async () => {
  await connect({
    client: {
      key: client.key,
      cert: client.cert,
      ca: server.ca.replace(/CERTIFICATE/g, "TRUSTED CERTIFICATE"),
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.cert,
      ca: client.ca,
      requestCert: true,
    },
  });
});

// Known gap (same as above): "BEGIN TRUSTED CERTIFICATE" on the server side: the CA
// never loads, so the (valid) client cert can't be verified and the server closes
// the connection (ECONNRESET). It fails closed, but the option is a no-op.
it.todo('Confirm server support for "BEGIN TRUSTED CERTIFICATE".', async () => {
  await connect({
    client: {
      key: client.key,
      cert: client.cert,
      ca: server.ca,
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.cert,
      ca: client.ca.replace(/CERTIFICATE/g, "TRUSTED CERTIFICATE"),
      requestCert: true,
    },
  });
});

it('Confirm client support for "BEGIN X509 CERTIFICATE".', async () => {
  await connect({
    client: {
      key: client.key,
      cert: client.cert,
      ca: server.ca.replace(/CERTIFICATE/g, "X509 CERTIFICATE"),
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.cert,
      ca: client.ca,
      requestCert: true,
    },
  });
});

it('Confirm server support for "BEGIN X509 CERTIFICATE".', async () => {
  await connect({
    client: {
      key: client.key,
      cert: client.cert,
      ca: server.ca,
      checkServerIdentity,
    },
    server: {
      key: server.key,
      cert: server.cert,
      ca: client.ca.replace(/CERTIFICATE/g, "X509 CERTIFICATE"),
      requestCert: true,
    },
  });
});

it("reports an invalid `tls.crl` with its own error code", async () => {
  using bunServer = Bun.serve({
    port: 0,
    tls: { key: server.key, cert: server.cert },
    fetch: () => new Response("ok"),
  });
  const error: any = await fetch(`https://localhost:${bunServer.port}/`, {
    tls: { ca: server.ca, crl: "this is not a CRL", rejectUnauthorized: false } as BunFetchRequestInitTLS,
  }).then(
    () => null,
    e => e,
  );
  expect(error?.code).toBe("InvalidCRL");
});

it("fetch applies tls.sigalgs even when it is the only TLS option", async () => {
  // `sigalgs` alone must still force a per-request SSL_CTX; without that the
  // fetch reuses the shared default context and silently drops the option.
  // The client only offers ECDSA while the server key is RSA, so honoring the
  // option must fail the handshake; the (much larger) default offer succeeds.
  const clientError = Promise.withResolvers<Error & { code?: string }>();
  const tlsServer = tls.createServer({ key: server.key, cert: server.cert }, socket => socket.end());
  tlsServer.on("tlsClientError", clientError.resolve);
  tlsServer.listen(0);
  await once(tlsServer, "listening");
  try {
    const port = (tlsServer.address() as any).port;
    // The fetch promise joins the race so an early client-side failure fails
    // the test immediately instead of timing out.
    const request = fetch(`https://127.0.0.1:${port}/`, {
      tls: { rejectUnauthorized: false, sigalgs: "ecdsa_secp256r1_sha256" } as BunFetchRequestInitTLS,
    }).then(
      () => "fetch-resolved",
      (error: Error & { code?: string }) => `fetch-rejected:${error.code ?? error.name}`,
    );
    const outcome = await Promise.race([
      once(tlsServer, "secureConnection").then(() => "handshake-completed"),
      clientError.promise.then(error => `rejected:${error.code}`),
      request.then(r => (r === "fetch-resolved" ? "handshake-completed" : r)),
    ]);
    expect(outcome).toBe("rejected:ERR_SSL_NO_COMMON_SIGNATURE_ALGORITHMS");
  } finally {
    tlsServer.close();
  }
});

it("tls.minVersion and tls.maxVersion take node's names or a protocol code, and reject other values", () => {
  const concat = (a: string, b: string) => a + b;
  const accepted = [
    "TLSv1",
    "TLSv1.1",
    "TLSv1.2",
    "TLSv1.3",
    concat("TLSv1", ".3"),
    null,
    undefined,
    0,
    0x0301,
    0x0302,
    0x0303,
    0x0304,
  ];
  const rejected = [
    "TLSv9",
    "tlsv1.3",
    "",
    new String("TLSv1.2"),
    1,
    -1,
    0x0305,
    // 0x0303 after a cast to uint16_t
    0x10303,
    771.5,
    2 ** 31,
    NaN,
    // 0x0303 as a BigInt: rejected, as in node
    771n,
    true,
    false,
    {},
    Symbol("TLSv1.2"),
  ];
  const parse = (tlsOptions: Record<string, unknown>) => {
    try {
      new Bun.FetchSession({ tls: tlsOptions as any })[Symbol.dispose]();
      return "accepted";
    } catch (e: any) {
      return `${e.name} ${e.code}`;
    }
  };
  for (const key of ["minVersion", "maxVersion"]) {
    expect(accepted.map(value => parse({ [key]: value }))).toEqual(accepted.map(() => "accepted"));
    expect(rejected.map(value => parse({ [key]: value }))).toEqual(
      rejected.map(() => "TypeError ERR_TLS_INVALID_PROTOCOL_VERSION"),
    );
  }

  // The message is node's: the value as node's %j prints it, then the bound.
  const message = (tlsOptions: Record<string, unknown>) => {
    try {
      new Bun.FetchSession({ tls: tlsOptions as any })[Symbol.dispose]();
    } catch (e: any) {
      return e.message;
    }
  };
  expect([
    message({ minVersion: "TLSv9" }),
    message({ minVersion: "" }),
    message({ minVersion: 'a"b' }),
    message({ maxVersion: 1 }),
  ]).toEqual([
    '"TLSv9" is not a valid minimum TLS protocol version',
    '"" is not a valid minimum TLS protocol version',
    '"a\\"b" is not a valid minimum TLS protocol version',
    "1 is not a valid maximum TLS protocol version",
  ]);
});

it("fetch applies tls.minVersion and tls.maxVersion to the handshake", async () => {
  let secureConnections = 0;
  const listen = async (options: tls.TlsOptions) => {
    const server = tls.createServer({ key: tlsCert.key, cert: tlsCert.cert, ...options }, socket => {
      secureConnections++;
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).includes("\r\n\r\n")) {
          const body = socket.getProtocol() ?? "";
          socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
        }
      });
      socket.on("error", () => {});
    });
    server.on("tlsClientError", () => {});
    const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", onListening);
    await listening;
    return server;
  };
  const negotiated = async (server: tls.Server, options: Record<string, unknown>) => {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`https://127.0.0.1:${port}/`, {
      keepalive: false,
      tls: { ca: tlsCert.cert, ...options } as any,
    });
    return await response.text();
  };

  const server = await listen({});
  const tls12Server = await listen({ maxVersion: "TLSv1.2" });
  const legacyServer = await listen({ minVersion: "TLSv1" });
  try {
    expect({
      minName: await negotiated(server, { minVersion: "TLSv1.3" }),
      maxName: await negotiated(server, { maxVersion: "TLSv1.2" }),
      bothNames: await negotiated(server, { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" }),
      maxCode: await negotiated(server, { maxVersion: 0x0303 }),
      tls12Server: await negotiated(tls12Server, {}),
      // A cap below the default floor needs the floor too.
      tls1: await negotiated(legacyServer, { minVersion: "TLSv1", maxVersion: "TLSv1" }),
      tls11: await negotiated(legacyServer, { minVersion: "TLSv1.1", maxVersion: "TLSv1.1" }),
    }).toEqual({
      minName: "TLSv1.3",
      maxName: "TLSv1.2",
      bothNames: "TLSv1.2",
      maxCode: "TLSv1.2",
      tls12Server: "TLSv1.2",
      tls1: "TLSv1",
      tls11: "TLSv1.1",
    });
    expect(secureConnections).toBe(7);

    // The floor is applied: a TLS 1.3 floor cannot reach the TLS 1.2 server.
    let handshakeError: any;
    try {
      await negotiated(tls12Server, { minVersion: "TLSv1.3" });
    } catch (e) {
      handshakeError = e;
    }
    expect(handshakeError).toBeInstanceOf(Error);
    expect(handshakeError.code).not.toBe("ERR_TLS_INVALID_PROTOCOL_VERSION");
    expect(secureConnections).toBe(7);

    // A bound as the only key is a TLS config with that bound: the handshake fails on
    // the version. An empty object has the defaults: the handshake reaches the certificate.
    const failure = async (tlsOptions: Record<string, unknown>) => {
      const port = (tls12Server.address() as AddressInfo).port;
      try {
        await fetch(`https://127.0.0.1:${port}/`, { keepalive: false, tls: tlsOptions as any });
        return "no error";
      } catch (e: any) {
        return e.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ? "certificate" : "handshake";
      }
    };
    expect({
      boundOnly: await failure({ minVersion: "TLSv1.3" }),
      empty: await failure({}),
    }).toEqual({ boundOnly: "handshake", empty: "certificate" });

    // A value that is not a version rejects before a connection is opened.
    const connectionsBefore = secureConnections;
    let optionError: any;
    try {
      await negotiated(server, { maxVersion: 13 });
    } catch (e) {
      optionError = e;
    }
    expect({ name: optionError?.name, code: optionError?.code, connections: secureConnections }).toEqual({
      name: "TypeError",
      code: "ERR_TLS_INVALID_PROTOCOL_VERSION",
      connections: connectionsBefore,
    });
  } finally {
    server.close();
    tls12Server.close();
    legacyServer.close();
  }
});
