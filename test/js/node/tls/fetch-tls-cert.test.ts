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
it.todo("complete cert chains sent to peer.", async () => {
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

it.todo(
  "Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer.",
  async () => {
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
  },
);

it.todo(
  "Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer. But using multi-PEM",
  async () => {
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
  },
);

it.todo(
  "Typical configuration error, incomplete cert chains sent, we have to know the peer's subordinate CAs in order to verify the peer. But using multi-PEM in an array",
  async () => {
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
  },
);

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

it.todo("Fail to complete client's chain.", async () => {
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
    expect(err.code).toBe("UNABLE_TO_GET_ISSUER_CERT");
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

it.todo("Server sent their CA, wrongly, but its OK since we know the CA locally.", async () => {
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

it.todo('Confirm client support for "BEGIN X509 CERTIFICATE".', async () => {
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

it.todo('Confirm server support for "BEGIN X509 CERTIFICATE".', async () => {
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
