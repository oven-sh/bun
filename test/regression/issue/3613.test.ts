import { expect, test } from "bun:test";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

// https://github.com/oven-sh/bun/issues/3613
// WebSocketServer handleProtocols option should set the selected protocol in the upgrade response.

async function upgradeRequest(wss: WebSocketServer, clientProtocols: string) {
  await once(wss, "listening");
  const { port } = wss.address() as AddressInfo;

  const connection = once(wss, "connection");
  const res = await fetch(`http://127.0.0.1:${port}`, {
    headers: {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Protocol": clientProtocols,
    },
  });
  await res.body?.cancel();
  // If the upgrade was rejected, let the caller's status assertion fail with the
  // actual status instead of hanging on a connection event that will never fire.
  const ws = res.status === 101 ? ((await connection)[0] as WebSocket) : undefined;
  return { res, ws };
}

test("ws WebSocketServer handleProtocols sets selected protocol", async () => {
  let receivedProtocols: Set<string> | undefined;
  let receivedRequest: IncomingMessage | undefined;
  const wss = new WebSocketServer({
    port: 0,
    handleProtocols: (protocols, request) => {
      receivedProtocols = protocols;
      receivedRequest = request;
      return "selected-protocol";
    },
  });
  let ws: WebSocket | undefined;
  try {
    const result = await upgradeRequest(wss, "custom-protocol, selected-protocol");
    ws = result.ws;

    expect(receivedProtocols).toBeInstanceOf(Set);
    expect([...receivedProtocols!]).toEqual(["custom-protocol", "selected-protocol"]);
    expect(receivedRequest?.headers["sec-websocket-protocol"]).toBe("custom-protocol, selected-protocol");

    expect(result.res.status).toBe(101);
    expect(result.res.headers.get("sec-websocket-protocol")).toBe("selected-protocol");
    expect(ws?.protocol).toBe("selected-protocol");
  } finally {
    ws?.close();
    wss.close();
  }
});

test("ws WebSocketServer handleProtocols with no protocol", async () => {
  const wss = new WebSocketServer({
    port: 0,
    handleProtocols: () => "",
  });
  let ws: WebSocket | undefined;
  try {
    const result = await upgradeRequest(wss, "custom-protocol");
    ws = result.ws;

    expect(result.res.status).toBe(101);
    expect(ws?.protocol).toBe("");
  } finally {
    ws?.close();
    wss.close();
  }
});

test("ws WebSocketServer without handleProtocols uses first client protocol", async () => {
  const wss = new WebSocketServer({ port: 0 });
  let ws: WebSocket | undefined;
  try {
    const result = await upgradeRequest(wss, "first-protocol, second-protocol");
    ws = result.ws;

    expect(result.res.status).toBe(101);
    expect(result.res.headers.get("sec-websocket-protocol")).toBe("first-protocol");
    expect(ws?.protocol).toBe("first-protocol");
  } finally {
    ws?.close();
    wss.close();
  }
});
