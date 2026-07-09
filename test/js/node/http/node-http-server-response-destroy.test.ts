/**
 * ServerResponse.destroy() must follow Writable.destroy semantics: 'close' is
 * emitted on a later tick (res.closed is still false when destroy() returns),
 * and the server tearing down its own response must not retroactively rewrite
 * an already fully-received request as a client abort.
 *
 * These tests also pass in Node.js.
 */
import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

describe.each([
  ["before any write", (_res: ServerResponse) => {}, undefined],
  [
    "after writeHead + partial body",
    (res: ServerResponse) => {
      res.writeHead(200, { "content-length": "50" });
      res.write("xx");
    },
    undefined,
  ],
  [
    "with an error argument",
    (res: ServerResponse) => {
      res.writeHead(200, { "content-length": "50" });
      res.write("xx");
    },
    Object.assign(new Error("boom"), { code: "EBOOM" }),
  ],
])("ServerResponse.destroy() %s", (_name, setup, err) => {
  it("defers 'close' and leaves a fully-received request complete (not aborted)", async () => {
    const events: string[] = [];
    let closedAtReturn: boolean | undefined;
    let reqRef!: IncomingMessage;

    const { promise: resClosed, resolve: resolveResClose } = Promise.withResolvers<void>();
    const { promise: reqClosed, resolve: resolveReqClose } = Promise.withResolvers<void>();

    await using server = createServer((req, res) => {
      reqRef = req;
      // Consume the (empty) body so 'end' is due on this request.
      req.on("data", () => {});
      req.on("aborted", () => events.push("req.aborted"));
      req.on("end", () => events.push("req.end"));
      req.on("close", () => {
        events.push("req.close");
        resolveReqClose();
      });
      res.on("close", () => {
        events.push("res.close");
        resolveResClose();
      });
      setup(res);
      events.push("call-destroy");
      res.destroy(err);
      closedAtReturn = res.closed;
      events.push("destroy-returned");
    }).listen(0, "127.0.0.1");
    await once(server, "listening");

    const client = connect((server.address() as AddressInfo).port, "127.0.0.1", () => {
      client.write("GET /x HTTP/1.1\r\nHost: h\r\n\r\n");
    });
    client.on("error", () => {});
    await once(client, "close");
    await Promise.all([resClosed, reqClosed]);

    // Writable.destroy semantics: 'close' is emitted on a later tick.
    expect(closedAtReturn).toBe(false);
    expect(events.indexOf("destroy-returned")).toBeLessThan(events.indexOf("res.close"));
    // The server destroying its own response is not a client abort: the
    // already-received request still gets 'end' and stays complete.
    expect(events).toEqual(["call-destroy", "destroy-returned", "req.end", "req.close", "res.close"]);
    expect({ aborted: reqRef.aborted, complete: reqRef.complete }).toEqual({ aborted: false, complete: true });
  });
});

it("standalone ServerResponse.destroy() defers 'close' to a later tick", async () => {
  const res = new ServerResponse(new IncomingMessage(undefined as any));
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  res.on("close", resolve);
  res.destroy();
  expect({ destroyed: res.destroyed, closed: res.closed }).toEqual({ destroyed: true, closed: false });
  await closed;
  expect(res.closed).toBe(true);
});
