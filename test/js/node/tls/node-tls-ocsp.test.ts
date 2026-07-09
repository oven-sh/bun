// OCSP stapling: the server-side 'OCSPRequest' event and the client-side
// 'OCSPResponse' event, the two halves of `tls.connect({ requestOCSP: true })`.
// https://nodejs.org/api/tls.html#event-ocsprequest
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls as cert1 } from "harness";
import { AddressInfo } from "net";
import { once } from "node:events";
import { join } from "node:path";
import { connect, createServer, TLSSocket } from "tls";

const COMMON_CERT = { ...cert1 };

describe("OCSP stapling", () => {
  // One full connect/close cycle, reported as the two endpoints' ordered event
  // logs. Events are asserted per endpoint because the interleaving between
  // them is not deterministic.
  async function exchange({
    serverOptions = {},
    clientOptions = {},
    onOCSPRequest,
    onOCSPResponse,
    awaitServer = true,
  }: {
    serverOptions?: object;
    clientOptions?: object;
    onOCSPRequest?: (callback: (err: Error | null, response?: unknown) => void) => void;
    onOCSPResponse?: (client: TLSSocket, response: Buffer | null) => void;
    awaitServer?: boolean;
  }) {
    const serverLog: string[] = [];
    const clientLog: string[] = [];
    const serverSettled = Promise.withResolvers<void>();
    // Not `once(client, "close")`: that rejects as soon as the socket emits
    // 'error', and the error paths below are exactly what some cases assert.
    const clientClosed = Promise.withResolvers<void>();

    const server = createServer({ ...COMMON_CERT, ...serverOptions }, socket => {
      serverLog.push("secureConnection");
      serverSettled.resolve();
      socket.end();
    });
    if (onOCSPRequest) {
      server.on("OCSPRequest", (certificate, issuer, callback) => {
        serverLog.push(
          `OCSPRequest certificate=${certificate?.constructor?.name} issuer=${issuer?.constructor?.name ?? "undefined"}`,
        );
        onOCSPRequest(callback);
      });
    }
    server.on("tlsClientError", err => {
      serverLog.push(`tlsClientError ${err.message}`);
      serverSettled.resolve();
    });

    try {
      server.listen(0);
      await once(server, "listening");
      const client = connect({
        port: (server.address() as AddressInfo).port,
        rejectUnauthorized: false,
        ...clientOptions,
      });
      client.on("OCSPResponse", response => {
        clientLog.push(`OCSPResponse ${response === null ? "null" : response.toString()}`);
        onOCSPResponse?.(client, response);
      });
      client.on("secureConnect", () => {
        clientLog.push("secureConnect");
        client.end();
      });
      client.on("error", err => clientLog.push(`clientError ${(err as any).code ?? err.message}`));
      client.on("close", () => clientClosed.resolve());
      await Promise.all([clientClosed.promise, awaitServer ? serverSettled.promise : Promise.resolve()]);
    } finally {
      server.close();
    }
    return { serverLog, clientLog };
  }

  it("staples a response the server produces asynchronously", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => setImmediate(callback, null, Buffer.from("hello ocsp")),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse hello ocsp", "secureConnect"]);
  });

  it("staples a response the server produces synchronously", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => callback(null, Buffer.from("sync ocsp")),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse sync ocsp", "secureConnect"]);
  });

  // Node's validateBuffer accepts any ArrayBufferView, DataView included, and so
  // does the native side; only the JS guard could have rejected it.
  it("staples a response handed back as a DataView", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => {
        const bytes = Buffer.from("dataview ocsp");
        callback(null, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      },
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse dataview ocsp", "secureConnect"]);
  });

  it("emits OCSPResponse with null when the server declines to staple", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => setImmediate(callback, null, null),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse null", "secureConnect"]);
  });

  it("emits OCSPResponse with null when the server has no OCSPRequest listener", async () => {
    const { serverLog, clientLog } = await exchange({ clientOptions: { requestOCSP: true } });
    expect(serverLog).toEqual(["secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse null", "secureConnect"]);
  });

  // Node stages an empty response and nothing ever reaches the wire, so the
  // client sees no staple and the handshake completes.
  it("treats an empty response as no staple", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => setImmediate(callback, null, Buffer.alloc(0)),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse null", "secureConnect"]);
  });

  // Node's onOCSP gates on `if (response)` (internal/tls/wrap.js), not
  // `response != null`: a falsy primitive is "nothing to staple", not a
  // validation error.
  it.each([0, false, ""])("treats callback(null, %p) as no staple", async falsy => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      // @ts-expect-error the listener is allowed to hand back nonsense
      onOCSPRequest: callback => setImmediate(callback, null, falsy),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse null", "secureConnect"]);
  });

  it("never emits OCSPRequest when the client did not ask for stapling", async () => {
    const { serverLog, clientLog } = await exchange({
      onOCSPRequest: callback => callback(null, Buffer.from("never sent")),
    });
    expect(serverLog).toEqual(["secureConnection"]);
    expect(clientLog).toEqual(["secureConnect"]);
  });

  it("staples over TLSv1.2", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true, maxVersion: "TLSv1.2" },
      onOCSPRequest: callback => setImmediate(callback, null, Buffer.from("tls 1.2 ocsp")),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse tls 1.2 ocsp", "secureConnect"]);
  });

  it("passes the issuer when the server context can resolve one", async () => {
    const { serverLog, clientLog } = await exchange({
      serverOptions: { ca: [COMMON_CERT.cert] },
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => callback(null, Buffer.from("with issuer")),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=Buffer", "secureConnection"]);
    expect(clientLog).toEqual(["OCSPResponse with issuer", "secureConnect"]);
  });

  it("reports callback(err) through tlsClientError and drops the connection", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => setImmediate(callback, new Error("ocsp lookup failed")),
    });
    expect(serverLog).toEqual(["OCSPRequest certificate=Buffer issuer=undefined", "tlsClientError ocsp lookup failed"]);
    expect(clientLog).toEqual(["clientError ECONNRESET"]);
  });

  it("rejects a response that is not a Buffer", async () => {
    const { serverLog, clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      // @ts-expect-error the listener is allowed to misbehave
      onOCSPRequest: callback => setImmediate(callback, null, "not a buffer"),
    });
    expect(serverLog).toEqual([
      "OCSPRequest certificate=Buffer issuer=undefined",
      "tlsClientError The \"response\" argument must be an instance of Buffer, TypedArray, or DataView. Received type string ('not a buffer')",
    ]);
    expect(clientLog).toEqual(["clientError ECONNRESET"]);
  });

  it("destroying the client from the OCSPResponse listener stops the connection", async () => {
    const { clientLog } = await exchange({
      clientOptions: { requestOCSP: true },
      onOCSPRequest: callback => callback(null, Buffer.from("rejected by client")),
      onOCSPResponse: client => client.destroy(),
      awaitServer: false,
    });
    expect(clientLog).toEqual(["OCSPResponse rejected by client"]);
  });
});

// TLS over a generic Duplex stream runs on the SSLWrapper engine, whose private
// memory BIO leaves the native status callback with no socket to dispatch
// 'OCSPResponse' on. Node honors `requestOCSP` there; Bun cannot yet, so it says
// so rather than putting `status_request` on the wire and dropping the answer.
describe("OCSP stapling over a Duplex stream", () => {
  it("warns that requestOCSP is ignored instead of silently dropping it", async () => {
    // A fresh process: the warning is emitted once per process, so an earlier
    // test tripping it would leave nothing here to observe.
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "node-tls-ocsp-duplex.fixture.ts")],
      env: { ...bunEnv, OCSP_CERT: COMMON_CERT.cert, OCSP_KEY: COMMON_CERT.key },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const warning =
      "requestOCSP is ignored for TLS over a Duplex stream or a named pipe: no OCSP response will be requested or delivered";
    expect(stderr.split(warning).length - 1).toBe(1);
    expect(JSON.parse(stdout)).toEqual({ serverLog: ["secureConnection"], clientLog: ["secureConnect"] });
    expect(exitCode).toBe(0);
  });
});
