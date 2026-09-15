import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

test("aborting a connection settles every queued pipelined response callback once", async () => {
  const queued = Promise.withResolvers<void>();
  const callbacksDone = Promise.withResolvers<void>();
  const queuedResponsesClosed = Promise.withResolvers<void>();
  const events: string[] = [];
  const callbackErrors: Error[] = [];
  let callbacksRemaining = 6;
  let closesRemaining = 2;

  const callback = (name: string) => (error?: Error) => {
    events.push(name);
    if (error) callbackErrors.push(error);
    if (--callbacksRemaining === 0) callbacksDone.resolve();
  };
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/a") return;

    const prefix = req.url!.slice(1);
    res.on("close", () => {
      events.push(`${prefix}:close`);
      if (--closesRemaining === 0) queuedResponsesClosed.resolve();
    });
    res.writeContinue(callback(`${prefix}:continue`));
    res.write("body", callback(`${prefix}:write`));
    res.end("end", callback(`${prefix}:end`));
    if (req.url === "/c") queued.resolve();
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const client = connect((server.address() as AddressInfo).port, "127.0.0.1");
  client.on("error", () => {});

  try {
    await new Promise<void>(resolve => client.once("connect", resolve));
    client.write(
      "GET /a HTTP/1.1\r\nHost: localhost\r\n\r\n" +
        "GET /b HTTP/1.1\r\nHost: localhost\r\n\r\n" +
        "GET /c HTTP/1.1\r\nHost: localhost\r\n\r\n",
    );
    await queued.promise;
    client.destroy();
    await Promise.all([callbacksDone.promise, queuedResponsesClosed.promise]);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(events.filter(event => !event.endsWith(":close")).sort()).toEqual([
      "b:continue",
      "b:end",
      "b:write",
      "c:continue",
      "c:end",
      "c:write",
    ]);
    expect(callbackErrors).toHaveLength(6);
    expect(new Set(callbackErrors).size).toBe(1);
    expect(callbackErrors[0]).toMatchObject({ code: "ERR_STREAM_DESTROYED" });
    for (const prefix of ["b", "c"]) {
      for (const operation of ["continue", "write", "end"]) {
        expect(events.indexOf(`${prefix}:close`)).toBeGreaterThan(events.indexOf(`${prefix}:${operation}`));
      }
    }
  } finally {
    client.destroy();
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
}, 10_000);
