// The server and the client of "trailers that wait for the stream's flow-control credit". They're two processes
// so that the client can block its thread, which stops it from returning credit while the server writes.
import { createPrivateKey } from "node:crypto";
import { readFileSync, readSync, writeSync } from "node:fs";
import { connect, listen, QuicEndpoint, type SessionOptions } from "node:quic";

const print = (line: string) => void writeSync(1, line + "\n");
const transportParams = { maxIdleTimeout: 10 };

if (process.argv[2] === "server") {
  const [keyPath, certPath, bodySize] = process.argv.slice(3);
  let sentLater = "";
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
        if (headers[":path"] === "/again") {
          return void this.sendHeaders({ ":status": "204", "x-sent-later": sentLater }, { terminal: true });
        }
        this.sendHeaders({ ":status": "200" });
        const close = () => void this.session.close({ code: 5n, type: "application" });
        // Tells the test what the response ran into first, once the packets written so far have been sent.
        let report: typeof print | undefined = print;
        const reportOnce = (line: string) => void setImmediate(() => void (report?.(line), (report = undefined)));
        let respond: (() => void) | undefined = () => {
          respond = undefined;
          this.onblocked = () => reportOnce("blocked");
          this.onstopsending = close;
          this.onwanttrailers = () => {
            this.sendTrailers({ "x-checksum": "abc123" });
            if (headers[":path"] === "/reset") {
              this.resetStream(7n);
              close();
            } else if (headers[":path"] === "/destroy") {
              this.destroy();
            } else if (headers[":path"] === "/more") {
              sentLater = String([
                this.sendTrailers({ "x-more": "1" }),
                this.sendHeaders({ ":status": "200" }),
                this.sendInformationalHeaders({ ":status": "103" }),
              ]);
            }
            reportOnce("trailers");
          };
          this.writer.writeSync(new Uint8Array(Number(bodySize)));
          this.writer.endSync();
        };
        // The client writes to its request, or ends it, right before it blocks.
        try {
          for await (const _ of this) respond?.();
        } catch {}
        respond?.();
      },
    },
  );
  print(String(endpoint.address!.port));
} else {
  const [action, port, ...windows] = process.argv.slice(3);
  const request = { ":method": "POST", ":path": "/" + action, ":scheme": "https", ":authority": "localhost" };
  for (const window of windows) {
    const row: Record<"trailers" | "failed" | "again" | "sentLater" | "closed" | "error", string | undefined> & {
      bytes?: number;
    } = {} as any;
    // Transport parameters belong to the endpoint, so each window needs its own.
    const endpoint = new QuicEndpoint();
    try {
      const session = await connect({ address: "127.0.0.1", port: Number(port) } as any, {
        endpoint,
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: { ...transportParams, initialMaxStreamDataBidiLocal: Number(window) },
        onerror() {},
      } as SessionOptions);
      const closed = session.closed.then(
        () => Promise.reject("the connection idled out"),
        error => String(error.message),
      );
      closed.catch(() => {});
      await session.opened;
      const gotHeaders = Promise.withResolvers<void>();
      closed.then(gotHeaders.reject, gotHeaders.reject);
      const stream: any = await session.createBidirectionalStream({
        onheaders: gotHeaders.resolve,
        ontrailers: (trailers: Record<string, string>) => void (row.trailers = trailers["x-checksum"]),
      } as any);
      stream.closed.catch(() => {});
      stream.sendHeaders(request);
      await gotHeaders.promise;
      // Outside of a callback, a write or the end of the request is sent before the call returns.
      await new Promise(resolve => setImmediate(resolve));
      const closes = action === "stop" || action === "reset";
      if (closes) stream.writer.writeSync(new Uint8Array(1));
      else stream.writer.endSync();
      // Nothing that arrives is read until the test writes a byte.
      if (readSync(0, new Uint8Array(1)) === 0) throw new Error("the server exited");
      if (closes) {
        if (action === "stop") stream.stopSending(9n);
        row.closed = await closed;
      } else {
        try {
          let bytes = 0;
          for await (const batch of stream) for (const chunk of batch) bytes += chunk.byteLength;
          await stream.closed;
          row.bytes = bytes;
        } catch (error: any) {
          row.failed = error.code;
        }
        const again: any = await session.createBidirectionalStream({
          headers: { ...request, ":method": "GET", ":path": "/again" },
          onheaders(headers: Record<string, string>) {
            row.again = headers[":status"];
            row.sentLater = headers["x-sent-later"] || undefined;
          },
        } as any);
        await again.closed;
        session.close();
      }
    } catch (error: any) {
      row.error = String(error?.code ?? error);
    }
    print(JSON.stringify(row));
    endpoint.close();
    if (row.error) break;
  }
  process.exit(0);
}
