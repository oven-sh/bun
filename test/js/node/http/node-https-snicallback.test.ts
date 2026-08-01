import { expect, it } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import nodefs from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { createSecureContext, connect as tlsConnect } from "node:tls";

// https://github.com/oven-sh/bun/issues/14395
it("https.createServer dispatches SNICallback and serves the selected certificate", async () => {
  const altCert = {
    key: nodefs.readFileSync(path.join(import.meta.dir, "..", "tls", "fixtures", "agent1-key.pem")),
    cert: nodefs.readFileSync(path.join(import.meta.dir, "..", "tls", "fixtures", "agent1-cert.pem")),
  };
  const altContext = createSecureContext(altCert);
  const calls: string[] = [];
  const server = createHttpsServer(
    {
      key: tlsCert.key,
      cert: tlsCert.cert,
      SNICallback(servername, cb) {
        calls.push(servername);
        if (servername === "agent1") cb(null, altContext);
        // Node accepts the unwrapped native handle too (`context.context || context`).
        else if (servername === "raw") cb(null, (altContext as any).context);
        else cb(null, undefined);
      },
    },
    (req, res) => res.end("ok"),
  );
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const connectCN = (servername: string) =>
      new Promise<string>((resolve, reject) => {
        const s = tlsConnect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false }, () => {
          const cn = s.getPeerCertificate().subject.CN;
          s.end();
          resolve(cn);
        });
        s.on("error", reject);
      });
    // SNICallback selects the agent1 context; the client must receive its CN.
    expect(await connectCN("agent1")).toBe("agent1");
    // The unwrapped native handle is accepted the same as the wrapper.
    expect(await connectCN("raw")).toBe("agent1");
    // cb(null, undefined) falls through to the default context.
    expect(await connectCN("other.local")).toBe("server-bun");
    expect(calls).toEqual(["agent1", "raw", "other.local"]);
  } finally {
    server.close();
  }
});

it("https.createServer rejects a non-function SNICallback", () => {
  expect(() => createHttpsServer({ key: tlsCert.key, cert: tlsCert.cert, SNICallback: 1 as any })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
});

it("https.createServer SNICallback errors drop the connection and emit tlsClientError", async () => {
  const cases: [string, (name: string, cb: (err: Error | null, ctx?: unknown) => void) => void, string][] = [
    ["cb(error)", (_name, cb) => cb(new Error("sni rejected")), "sni rejected"],
    ["invalid primitive", (_name, cb) => cb(null, true), "Invalid SNI context"],
    [
      "throw",
      () => {
        throw new Error("sni threw");
      },
      "sni threw",
    ],
  ];
  for (const [, SNICallback, expectedMessage] of cases) {
    const server = createHttpsServer({ key: tlsCert.key, cert: tlsCert.cert, SNICallback }, (req, res) => res.end());
    const tlsClientErrors: Error[] = [];
    server.on("tlsClientError", err => tlsClientErrors.push(err));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const client = tlsConnect({ host: "127.0.0.1", port, servername: "a.example.com", rejectUnauthorized: false });
    const [clientErr] = (await once(client, "error")) as [NodeJS.ErrnoException];
    // The server dropped the connection before the handshake completed.
    expect(String(clientErr.message)).toMatch(/disconnected before secure TLS connection was established|ECONNRESET/);
    expect(tlsClientErrors.length).toBe(1);
    expect(tlsClientErrors[0].message).toBe(expectedMessage);
    server.close();
  }
});
