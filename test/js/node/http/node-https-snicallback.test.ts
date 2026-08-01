import { expect, it } from "bun:test";
import { tls as tlsCert } from "harness";
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
