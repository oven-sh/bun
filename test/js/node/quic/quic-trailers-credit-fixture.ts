// The server and the client of "trailers wait for the stream's flow-control credit". They're two processes
// so that the client can block its thread, which stops it from returning credit while the server writes.
import { createPrivateKey } from "node:crypto";
import { readFileSync, readSync, writeSync } from "node:fs";
import { connect, listen, QuicEndpoint, type SessionOptions } from "node:quic";

const print = (line: string) => void writeSync(1, line + "\n");
const transportParams = { maxIdleTimeout: 10 };

if (process.argv[2] === "server") {
  const [keyPath, certPath, bodySize] = process.argv.slice(3);
  const endpoint = await listen(
    session => {
      session.onerror = () => {};
      session.closed.catch(() => {});
      session.onstream = (stream: any) => void stream.closed.catch(() => {});
    },
    {
      sni: { "*": { keys: [createPrivateKey(readFileSync(keyPath))], certs: [readFileSync(certPath)] } },
      transportParams,
      async onheaders(this: any, headers: Record<string, string>) {
        if (headers[":path"] === "/again") return void this.sendHeaders({ ":status": "204" }, { terminal: true });
        this.sendHeaders({ ":status": "200" });
        // The client ends its request right before it blocks.
        for await (const _ of this);
        // Tells the test what the response ran into first, once the packets written so far have been sent.
        let report: typeof print | undefined = print;
        const reportOnce = (line: string) => void setImmediate(() => void (report?.(line), (report = undefined)));
        this.onblocked = () => reportOnce("blocked");
        this.onwanttrailers = () => {
          this.sendTrailers({ "x-checksum": "abc123" });
          reportOnce("trailers");
        };
        this.writer.writeSync(new Uint8Array(Number(bodySize)));
        this.writer.endSync();
      },
    },
  );
  print(String(endpoint.address!.port));
} else {
  const [port, ...windows] = process.argv.slice(3).map(Number);
  const get = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  for (const initialMaxStreamDataBidiLocal of windows) {
    const row: { bytes: number; trailers?: string; again?: string; error?: string } = { bytes: 0 };
    // Transport parameters belong to the endpoint, so each window needs its own.
    const endpoint = new QuicEndpoint();
    const session = await connect({ address: "127.0.0.1", port } as any, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { ...transportParams, initialMaxStreamDataBidiLocal },
      onerror() {},
    } as SessionOptions);
    session.closed.catch(() => {});
    try {
      await session.opened;
      const gotHeaders = Promise.withResolvers<void>();
      const stream: any = await session.createBidirectionalStream({
        onheaders: gotHeaders.resolve,
        ontrailers: (trailers: Record<string, string>) => void (row.trailers = trailers["x-checksum"]),
      } as any);
      stream.sendHeaders({ ...get, ":method": "POST" });
      await gotHeaders.promise;
      // Outside of a callback, the end of the request is sent before endSync() returns.
      await new Promise(resolve => setImmediate(resolve));
      stream.writer.endSync();
      // Nothing that arrives is read until the test writes a byte.
      readSync(0, new Uint8Array(1));
      for await (const batch of stream) for (const chunk of batch) row.bytes += chunk.byteLength;
      await stream.closed;
      const again: any = await session.createBidirectionalStream({
        headers: { ...get, ":path": "/again" },
        onheaders: (headers: Record<string, string>) => void (row.again = headers[":status"]),
      } as any);
      await again.closed;
    } catch (error: any) {
      row.error = String(error?.code ?? error);
    }
    print(JSON.stringify(row));
    session.close();
    endpoint.close();
    if (row.error) break;
  }
  process.exit(0);
}
