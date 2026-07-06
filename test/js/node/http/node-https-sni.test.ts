import { expect, it } from "bun:test";
import { readFileSync } from "fs";
import { tls as defaultCert } from "harness";
import { once } from "node:events";
import https from "node:https";
import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { join } from "path";

// The default identity is CN=server-bun; the SNI identity is CN=agent1, so the
// certificate the server picked is readable straight off the peer certificate.
const keys = join(import.meta.dir, "../test/fixtures/keys");
const sniCert = {
  key: readFileSync(join(keys, "agent1-key.pem"), "utf8"),
  cert: readFileSync(join(keys, "agent1-cert.pem"), "utf8"),
};

type Outcome = { cn: string } | { error: string };

/** Resolves to the CN the server served, or the error the handshake failed with. */
function handshake(port: number, servername: string): Promise<Outcome> {
  const { promise, resolve } = Promise.withResolvers<Outcome>();
  const socket = tls.connect({ port, host: "127.0.0.1", servername, rejectUnauthorized: false }, () => {
    resolve({ cn: String(socket.getPeerCertificate().subject?.CN) });
    socket.end();
  });
  socket.on("error", err => resolve({ error: (err as NodeJS.ErrnoException).code ?? err.message }));
  return promise;
}

async function listen(server: https.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

it("https.Server SNICallback selects the certificate per connection", async () => {
  const names: string[] = [];
  const altContext = tls.createSecureContext(sniCert);
  const server = https.createServer(
    {
      ...defaultCert,
      SNICallback(name, cb) {
        names.push(name);
        cb(null, name === "alt.example" ? altContext : undefined);
      },
    },
    (_req, res) => res.end("ok"),
  );

  try {
    const port = await listen(server);
    expect(await handshake(port, "alt.example")).toEqual({ cn: "agent1" });
    expect(await handshake(port, "localhost")).toEqual({ cn: "server-bun" });
    expect(names).toEqual(["alt.example", "localhost"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

it("https.Server serves requests through the SNICallback-selected certificate", async () => {
  const altContext = tls.createSecureContext(sniCert);
  const server = https.createServer(
    { ...defaultCert, SNICallback: (_name, cb) => cb(null, altContext) },
    (_req, res) => res.end("hello"),
  );

  try {
    const port = await listen(server);
    const { promise, resolve, reject } = Promise.withResolvers<{ cn: string; body: string }>();
    const req = https.get(
      { port, host: "127.0.0.1", servername: "alt.example", rejectUnauthorized: false, path: "/" },
      res => {
        const cn = String((res.socket as tls.TLSSocket).getPeerCertificate().subject?.CN);
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => (body += chunk));
        res.on("end", () => resolve({ cn, body }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    expect(await promise).toEqual({ cn: "agent1", body: "hello" });
  } finally {
    server.close();
    await once(server, "close");
  }
});

it("https.Server SNICallback errors refuse the handshake", async () => {
  const cases: [string, (name: string, cb: (err: Error | null, ctx?: unknown) => void) => void][] = [
    ["cb(error)", (_name, cb) => cb(new Error("sni rejected"))],
    ["invalid context", (_name, cb) => cb(null, {})],
    [
      "throw",
      () => {
        throw new Error("sni threw");
      },
    ],
  ];

  for (const [label, SNICallback] of cases) {
    const server = https.createServer({ ...defaultCert, SNICallback }, (_req, res) => res.end("must not happen"));
    try {
      const port = await listen(server);
      const outcome = await handshake(port, "refused.example");
      // The connection is dropped before the handshake completes, without a TLS
      // alert, exactly like tls.Server does for the same callback shapes.
      expect(outcome, label).toEqual({ error: expect.stringMatching(/ECONNRESET|EPROTO|ERR_SSL|disconnected/) });
    } finally {
      server.close();
      await once(server, "close");
    }
  }
});

it("https.Server SNICallback selecting no context falls through to the default", async () => {
  const server = https.createServer({ ...defaultCert, SNICallback: (_name, cb) => cb(null, null) }, (_req, res) =>
    res.end("ok"),
  );
  try {
    const port = await listen(server);
    expect(await handshake(port, "unknown.example")).toEqual({ cn: "server-bun" });
  } finally {
    server.close();
    await once(server, "close");
  }
});

it("https.Server suspends the handshake for an asynchronous SNICallback", async () => {
  const altContext = tls.createSecureContext(sniCert);
  let resolvedAsynchronously = false;
  const server = https.createServer(
    {
      ...defaultCert,
      SNICallback(_name, cb) {
        // setImmediate runs strictly after the native dispatch returned, so the
        // handshake has to park until the resolution lands.
        setImmediate(() => {
          resolvedAsynchronously = true;
          cb(null, altContext);
        });
      },
    },
    (_req, res) => res.end("ok"),
  );

  try {
    const port = await listen(server);
    expect(await handshake(port, "async.example")).toEqual({ cn: "agent1" });
    expect(resolvedAsynchronously).toBe(true);
  } finally {
    server.close();
    await once(server, "close");
  }
});

it("https.Server aborts a suspended handshake when the asynchronous SNICallback errors", async () => {
  const server = https.createServer({ ...defaultCert, SNICallback: (_name, cb) => setImmediate(() => cb(new Error("async sni rejected"))) }, (_req, res) =>
    res.end("must not happen"),
  );
  try {
    const port = await listen(server);
    expect(await handshake(port, "async-refused.example")).toEqual({
      error: expect.stringMatching(/ECONNRESET|EPROTO|ERR_SSL|disconnected/),
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});

it("https.Server survives a connection destroyed while its SNICallback is pending", async () => {
  let resolveLater: (() => void) | undefined;
  const { promise: dispatched, resolve: onDispatch } = Promise.withResolvers<void>();
  const altContext = tls.createSecureContext(sniCert);
  const server = https.createServer(
    {
      ...defaultCert,
      SNICallback(name, cb) {
        if (name === "gone.example") {
          // Stash the resolution so it fires only after the client is gone.
          resolveLater = () => cb(null, altContext);
          onDispatch();
          return;
        }
        cb(null, altContext);
      },
    },
    (_req, res) => res.end("ok"),
  );

  try {
    const port = await listen(server);
    const client = tls.connect({ port, host: "127.0.0.1", servername: "gone.example", rejectUnauthorized: false });
    client.on("error", () => {});
    await dispatched;
    const closed = once(client, "close");
    client.destroy();
    await closed;
    // Resolving a handshake whose connection already died must be a safe no-op.
    resolveLater!();

    // The server must still be usable after the stale resolution.
    expect(await handshake(port, "alt.example")).toEqual({ cn: "agent1" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
