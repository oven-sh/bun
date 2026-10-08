// A websocket peer with no websocket implementation: a TCP or TLS socket that does the upgrade by hand and reports
// each frame it gets. Tests use it to read what a socket of the `ws` module puts on the wire.
import crypto from "crypto";
import { once } from "events";
import { tls } from "harness";
import { createServer } from "http";
import { createServer as createSecureServer } from "https";
import { AddressInfo, connect, createServer as createNetServer, Socket } from "net";
import { connect as connectTLS, createServer as createTLSServer } from "tls";
import type { WebSocket, WebSocketServer } from "ws";

export type WireFrame = { fin: boolean; rsv1: boolean; opcode: number; payload: string };
export type WsImplementation = { WebSocket: typeof WebSocket; WebSocketServer: typeof WebSocketServer };

export const TEXT = 1;
export const BINARY = 2;

/** A whole frame with no RSV bit. `payload` is hex. */
export const frame = (opcode: number, payload: string): WireFrame => ({ fin: true, rsv1: false, opcode, payload });

/**
 * Hands each frame of a byte stream to `onFrame`, with the unmasked payload as hex. Of a frame of more than 64 KiB
 * it keeps the first byte and the count of the others: "41+4194303" is 4 MiB that start with 0x41.
 */
export function frameReader(onFrame: (frame: WireFrame) => void) {
  let pending: Buffer = Buffer.alloc(0);
  let skip = 0;
  return (chunk: Buffer) => {
    if (skip > 0) {
      const skipped = Math.min(skip, chunk.length);
      skip -= skipped;
      if (skipped === chunk.length) return;
      chunk = chunk.subarray(skipped);
    }
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 2) {
      const masked = (pending[1] & 0x80) !== 0;
      let length = pending[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) return;
        length = Number(pending.readBigUInt64BE(2));
        offset = 10;
      }
      const key = masked ? pending.subarray(offset, offset + 4) : undefined;
      if (masked) offset += 4;
      const large = length > 64 * 1024;
      if (pending.length < offset + (large ? 1 : length)) return;
      const payload = Buffer.from(pending.subarray(offset, offset + (large ? 1 : length)));
      if (key) for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      const head = { fin: (pending[0] & 0x80) !== 0, rsv1: (pending[0] & 0x40) !== 0, opcode: pending[0] & 0x0f };
      if (large) {
        onFrame({ ...head, payload: `${payload.toString("hex")}+${length - 1}` });
        skip = Math.max(0, offset + length - pending.length);
        pending = pending.subarray(Math.min(pending.length, offset + length));
      } else {
        onFrame({ ...head, payload: payload.toString("hex") });
        pending = pending.subarray(offset + length);
      }
    }
  };
}

// The peer side of a raw socket: it reads the HTTP head, hands it to `onHead`, then reads frames.
function readAfterHead(
  socket: Socket,
  onHead: (head: string) => void,
  onFrame: (frame: WireFrame) => void,
  onError: (error: Error) => void,
) {
  const read = frameReader(onFrame);
  let head: Buffer | null = Buffer.alloc(0);
  socket.on("error", onError);
  socket.on("close", () => onError(new Error("the raw peer socket closed")));
  socket.on("data", (chunk: Buffer) => {
    if (head === null) return read(chunk);
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end === -1) return;
    const rest = head.subarray(end + 4);
    onHead(head.subarray(0, end).toString("latin1"));
    head = null;
    if (rest.length) read(rest);
  });
}

// A TCP or TLS client. It asks for the upgrade, and `upgraded` resolves when the server answered with 101.
function rawClient(
  port: number,
  secure: boolean,
  onFrame: (frame: WireFrame) => void,
  onError: (error: Error) => void,
) {
  const upgraded = Promise.withResolvers<void>();
  const request =
    "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
  const peer: Socket = secure
    ? connectTLS({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => peer.write(request))
    : connect(port, "127.0.0.1", () => peer.write(request));
  const onHead = (head: string) => {
    if (head.startsWith("HTTP/1.1 101")) upgraded.resolve();
    else onError(new Error(`the server did not upgrade: ${head.split("\r\n", 1)[0]}`));
  };
  readAfterHead(peer, onHead, onFrame, onError);
  return { peer, upgraded: upgraded.promise };
}

/**
 * Opens a socket of `implementation`, on the `side` under test, to a raw peer. The peer gives every frame it gets to
 * `onFrame`. `failure` rejects when one of the two ends fails or closes. A raw server answers the upgrade with
 * `extensions` as its Sec-WebSocket-Extensions header.
 */
export async function openToRawPeer(
  { WebSocket: Client, WebSocketServer: ServerClass }: WsImplementation,
  side: "server" | "client",
  secure: boolean,
  onFrame: (frame: WireFrame) => void,
  extensions?: string,
) {
  const failure = Promise.withResolvers<never>();
  failure.promise.catch(() => {});
  const watch = (ws: WebSocket) => {
    ws.on("error", failure.reject);
    ws.on("close", (code, reason) => failure.reject(new Error(`the socket closed with ${code} ${reason}`)));
  };

  if (side === "server") {
    const server = secure ? createSecureServer({ ...tls }) : createServer();
    const wss = new ServerClass({ server });
    let peer: Socket | undefined;
    const close = () => {
      peer?.destroy();
      wss.close();
      server.close();
    };
    try {
      const connection = Promise.withResolvers<WebSocket>();
      wss.on("error", failure.reject);
      wss.on("connection", ws => {
        watch(ws);
        connection.resolve(ws);
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const client = rawClient((server.address() as AddressInfo).port, secure, onFrame, failure.reject);
      peer = client.peer;
      const ws = await Promise.race([connection.promise, failure.promise]);
      await Promise.race([client.upgraded, failure.promise]);
      return {
        ws,
        peer,
        failure: failure.promise,
        close() {
          ws.terminate();
          close();
        },
      };
    } catch (error) {
      close();
      throw error;
    }
  }

  const server = secure ? createTLSServer({ ...tls }) : createNetServer();
  let ws: WebSocket | undefined;
  let peer: Socket | undefined;
  const close = () => {
    ws?.terminate();
    peer?.destroy();
    server.close();
  };
  try {
    const accepted = Promise.withResolvers<Socket>();
    server.on("error", failure.reject);
    server.on(secure ? "secureConnection" : "connection", (socket: Socket) => {
      const accept = (head: string) => {
        const key = /^sec-websocket-key:\s*(\S+)/im.exec(head)![1];
        const digest = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${digest}\r\n` +
            (extensions ? `Sec-WebSocket-Extensions: ${extensions}\r\n` : "") +
            "\r\n",
        );
      };
      readAfterHead(socket, accept, onFrame, failure.reject);
      accepted.resolve(socket);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    // Trusts the self-signed certificate: `rejectUnauthorized` is the option of npm ws, `tls` the one of the built-in.
    const trust: object = { rejectUnauthorized: false, tls: { rejectUnauthorized: false } };
    const opened = Promise.withResolvers<void>();
    ws = new Client(`${secure ? "wss" : "ws"}://127.0.0.1:${port}`, trust);
    watch(ws);
    ws.on("open", () => opened.resolve());
    await Promise.race([opened.promise, failure.promise]);
    peer = await Promise.race([accepted.promise, failure.promise]);
    return { ws, peer, failure: failure.promise, close };
  } catch (error) {
    close();
    throw error;
  }
}
