import { expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const client = {
  key: readFileSync(join(import.meta.dir, "fixtures", "ec10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "ec10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca5-cert.pem"), "utf8"),
};
const server = {
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
split(client.cert, client);
split(server.cert, server);

// The certificates aren't for "localhost", so override the identity check.
function checkServerIdentity(hostname: string, cert: any) {
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

// TODO: this requires maxVersion/minVersion
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
