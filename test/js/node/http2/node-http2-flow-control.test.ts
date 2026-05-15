import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const FRAME_DATA = 0x0;
const FRAME_HEADERS = 0x1;
const FRAME_SETTINGS = 0x4;
const FRAME_WINDOW_UPDATE = 0x8;
const DEFAULT_WINDOW_SIZE = 65_535;
const FLAG_ACK = 0x1;
const FLAG_END_STREAM = 0x1;
const FLAG_END_HEADERS = 0x4;
const SETTING_INITIAL_WINDOW_SIZE = 0x4;

function frame(type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) {
  const buf = Buffer.alloc(9 + payload.length);
  buf.writeUIntBE(payload.length, 0, 3);
  buf[3] = type;
  buf[4] = flags;
  buf.writeUInt32BE(streamId & 0x7fffffff, 5);
  payload.copy(buf, 9);
  return buf;
}

function setting(id: number, value: number) {
  const buf = Buffer.alloc(6);
  buf.writeUInt16BE(id, 0);
  buf.writeUInt32BE(value >>> 0, 2);
  return buf;
}

function windowUpdate(increment: number) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(increment & 0x7fffffff);
  return buf;
}

function closeServer(server: net.Server, sockets: Set<net.Socket>) {
  return new Promise<void>((resolve, reject) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close(err => (err ? reject(err) : resolve()));
  });
}

async function withRawH2Server(
  onFrame: (socket: net.Socket, type: number, flags: number, streamId: number, len: number) => void | boolean,
  fn: (url: string) => Promise<void>,
) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    let buf = Buffer.alloc(0);
    let prefaceSeen = false;

    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceSeen) {
        if (buf.length < 24) return;
        expect(buf.subarray(0, 24).toString()).toBe("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
        buf = buf.subarray(24);
        prefaceSeen = true;
        socket.write(frame(FRAME_SETTINGS, 0, 0));
      }

      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) return;

        const type = buf[3];
        const flags = buf[4];
        const streamId = buf.readUInt32BE(5) & 0x7fffffff;
        buf = buf.subarray(9 + len);

        if (type === FRAME_SETTINGS && !(flags & FLAG_ACK)) {
          socket.write(frame(FRAME_SETTINGS, FLAG_ACK, 0));
          continue;
        }

        if (onFrame(socket, type, flags, streamId, len)) {
          return;
        }
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await closeServer(server, sockets);
  }
}

function post(client: http2.ClientHttp2Session, payload: Buffer) {
  return new Promise<{ status: number; writeCallbackFired: boolean }>((resolve, reject) => {
    let status = 0;
    let writeCallbackFired = false;
    const req = client.request({ ":method": "POST", ":path": "/" });

    req.on("response", headers => {
      status = Number(headers[":status"]);
    });
    req.on("end", () => resolve({ status, writeCallbackFired }));
    req.on("error", reject);
    req.resume();
    req.end(payload, () => {
      writeCallbackFired = true;
    });
  });
}

test("http2 client applies remote initialWindowSize changes to open stream write callbacks", async () => {
  let bumpedWindow = false;

  await withRawH2Server(
    (socket, type, flags, streamId) => {
      if (type === FRAME_HEADERS && !bumpedWindow) {
        bumpedWindow = true;
        // Send the SETTINGS update after a request stream already exists. The
        // queued tail of the request body must be released by the settings delta.
        socket.write(frame(FRAME_WINDOW_UPDATE, 0, 0, windowUpdate(16 * 1024 * 1024)));
        socket.write(frame(FRAME_SETTINGS, 0, 0, setting(SETTING_INITIAL_WINDOW_SIZE, 256 * 1024)));
        return false;
      }

      if (type === FRAME_DATA && flags & FLAG_END_STREAM) {
        socket.write(frame(FRAME_HEADERS, FLAG_END_HEADERS | FLAG_END_STREAM, streamId, Buffer.from([0x88])));
      }
      return false;
    },
    async url => {
      const client = http2.connect(url);
      await once(client, "connect");

      try {
        const payload = Buffer.alloc(86_155, "x");
        const responses = await Promise.all(Array.from({ length: 16 }, () => post(client, payload)));

        expect(responses).toEqual(Array.from({ length: 16 }, () => ({ status: 200, writeCallbackFired: true })));
      } finally {
        client.close();
      }
    },
  );
});

test("http2 client keeps a negative stream window after remote initialWindowSize shrinks", async () => {
  let resolveInitialSettingsAck: () => void = () => {};
  const initialSettingsAck = new Promise<void>(resolve => {
    resolveInitialSettingsAck = resolve;
  });
  let bumpedWindow = false;
  let smallStreamUpdateSent = false;
  let settingsAckSeen = false;
  let sentEnoughStreamCredit = false;
  let settingsAcksAfterShrink = 0;
  let dataBytes = 0;
  let sentDataBeforePositiveWindow = false;
  let shrinkingStreamId = 0;

  await withRawH2Server(
    (socket, type, flags, streamId, len) => {
      if (type === FRAME_SETTINGS && flags & FLAG_ACK && !bumpedWindow) {
        resolveInitialSettingsAck();
        return false;
      }

      if (type === FRAME_HEADERS && !bumpedWindow) {
        bumpedWindow = true;
        shrinkingStreamId = streamId;
        socket.write(frame(FRAME_WINDOW_UPDATE, 0, 0, windowUpdate(16 * 1024 * 1024)));
        return false;
      }

      if (type === FRAME_DATA) {
        dataBytes += len;
        if (smallStreamUpdateSent && !settingsAckSeen && dataBytes > DEFAULT_WINDOW_SIZE) {
          sentDataBeforePositiveWindow = true;
        }
        if (!smallStreamUpdateSent && dataBytes >= 32 * 1024) {
          smallStreamUpdateSent = true;
          socket.write(frame(FRAME_SETTINGS, 0, 0, setting(SETTING_INITIAL_WINDOW_SIZE, 16 * 1024)));
          socket.write(frame(FRAME_WINDOW_UPDATE, 0, shrinkingStreamId, windowUpdate(10 * 1024)));
          socket.write(frame(FRAME_SETTINGS, 0, 0));
        }
        if (flags & FLAG_END_STREAM) {
          socket.write(frame(FRAME_HEADERS, FLAG_END_HEADERS | FLAG_END_STREAM, streamId, Buffer.from([0x88])));
        }
        return false;
      }

      if (type === FRAME_SETTINGS && flags & FLAG_ACK && smallStreamUpdateSent && !sentEnoughStreamCredit) {
        settingsAcksAfterShrink++;
        if (settingsAcksAfterShrink >= 2) {
          settingsAckSeen = true;
          expect(sentDataBeforePositiveWindow).toBe(false);
          sentEnoughStreamCredit = true;
          socket.write(frame(FRAME_WINDOW_UPDATE, 0, shrinkingStreamId, windowUpdate(60 * 1024)));
        }
      }
      return false;
    },
    async url => {
      const client = http2.connect(url);
      await once(client, "connect");
      await initialSettingsAck;

      try {
        const response = await post(client, Buffer.alloc(DEFAULT_WINDOW_SIZE + 14_465, "x"));

        expect(response).toEqual({ status: 200, writeCallbackFired: true });
        expect(settingsAckSeen).toBe(true);
      } finally {
        client.close();
      }
    },
  );
});

test("http2 client rejects SETTINGS_INITIAL_WINDOW_SIZE above 2^31-1", async () => {
  await withRawH2Server(
    (socket, type) => {
      if (type === FRAME_HEADERS) {
        socket.write(frame(FRAME_SETTINGS, 0, 0, setting(SETTING_INITIAL_WINDOW_SIZE, 0x80000000)));
        return true;
      }
      return false;
    },
    async url => {
      const client = http2.connect(url);
      await once(client, "connect");

      const error = new Promise<Error & { code?: string }>(resolve => client.once("error", resolve));
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.end();

      try {
        const err = await error;
        expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(err.message).toBe("Session closed with error code NGHTTP2_FLOW_CONTROL_ERROR");
      } finally {
        client.destroy();
      }
    },
  );
});
