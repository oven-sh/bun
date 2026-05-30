import { expect, test } from "bun:test";
import { Socket } from "node:net";

// new Socket({handle, manualStart}) wires _handle.onread = onStreamRead and
// drives reads via readStart/readStop (Node's stream-wrap contract). The
// handle here is a JS mock — the native TTY/Pipe handles ship in follow-ups.
test("net.Socket({handle, manualStart}) drives onStreamRead", async () => {
  let onread;
  let readStartCalls = 0;
  const handle = {
    readStart() {
      readStartCalls++;
      return 0;
    },
    readStop() {
      return 0;
    },
    close() {},
    set onread(fn) {
      onread = fn;
    },
    get onread() {
      return onread;
    },
    reading: false,
  };

  const socket = new Socket({ handle, manualStart: true, writable: false });
  expect(socket._handle).toBe(handle);
  expect(typeof onread).toBe("function");
  expect(readStartCalls).toBe(0); // manualStart

  const chunks: Buffer[] = [];
  socket.on("data", c => chunks.push(c));
  await Bun.sleep(0);
  expect(readStartCalls).toBe(1); // _read → tryReadStart

  onread.call(handle, 5, Buffer.from("hello"));
  onread.call(handle, -4095, undefined); // UV_EOF

  await new Promise(resolve => socket.on("end", resolve));

  expect(Buffer.concat(chunks).toString()).toBe("hello");
  expect(socket.bytesRead).toBe(5);
  expect(socket.writable).toBe(false);
});

// onread: {buffer, callback} must deliver the caller's buffer to the
// callback, not the handle's internal buffer.
test("net.Socket({handle, onread}) passes user buffer to callback", async () => {
  let onread;
  const handle = {
    readStart() {
      return 0;
    },
    readStop() {
      return 0;
    },
    close() {},
    set onread(fn) {
      onread = fn;
    },
    get onread() {
      return onread;
    },
    reading: false,
  };

  const userBuf = Buffer.alloc(16);
  const calls: { nread: number; buf: Buffer }[] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    writable: false,
    onread: {
      buffer: userBuf,
      callback(nread, buf) {
        calls.push({ nread, buf });
      },
    },
  });
  socket.read(0);

  const handleBuf = Buffer.from("hello");
  onread.call(handle, 5, handleBuf);
  onread.call(handle, -4095, undefined); // UV_EOF

  await new Promise(resolve => socket.on("end", resolve));

  expect(calls.length).toBe(1);
  expect(calls[0].nread).toBe(5);
  expect(calls[0].buf).toBe(userBuf); // identity, not the handle's buffer
  expect(calls[0].buf).not.toBe(handleBuf);
  expect(userBuf.subarray(0, 5).toString()).toBe("hello");
});

// A stream-wrap handle (Pipe/TTY) reads into its own buffer and can deliver a
// chunk larger than the user's onread buffer. onStreamRead must slice it into
// buffer-sized pieces and deliver every byte, not truncate to one callback.
test("net.Socket({handle, onread}) does not drop bytes when chunk > user buffer", async () => {
  let onread;
  const handle = {
    readStart() {
      return 0;
    },
    readStop() {
      return 0;
    },
    close() {},
    set onread(fn) {
      onread = fn;
    },
    get onread() {
      return onread;
    },
    reading: false,
  };

  const userBuf = Buffer.alloc(4);
  const received: Buffer[] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    writable: false,
    onread: {
      buffer: userBuf,
      callback(nread, buf) {
        // Copy out — userBuf is reused across callbacks.
        received.push(Buffer.from(buf.subarray(0, nread)));
      },
    },
  });
  socket.read(0);

  // 10 bytes into a 4-byte buffer → expect slices of 4, 4, 2.
  onread.call(handle, 10, Buffer.from("0123456789"));
  onread.call(handle, -4095, undefined); // UV_EOF

  await new Promise(resolve => socket.on("end", resolve));

  expect(received.map(b => b.toString())).toEqual(["0123", "4567", "89"]);
  expect(Buffer.concat(received).toString()).toBe("0123456789");
  expect(socket.bytesRead).toBe(10);
});

// Returning false from the onread callback means "pause future reads", not
// "discard the rest of this chunk". Every byte of the in-hand chunk must still
// be delivered before readStop() is applied.
test("net.Socket({handle, onread}) delivers the whole chunk even if callback returns false", async () => {
  let onread;
  let readStopCalls = 0;
  const handle = {
    readStart() {
      return 0;
    },
    readStop() {
      readStopCalls++;
      return 0;
    },
    close() {},
    set onread(fn) {
      onread = fn;
    },
    get onread() {
      return onread;
    },
    reading: true,
  };

  const userBuf = Buffer.alloc(4);
  const received: Buffer[] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    writable: false,
    onread: {
      buffer: userBuf,
      callback(nread, buf) {
        received.push(Buffer.from(buf.subarray(0, nread)));
        return false; // backpressure on every slice
      },
    },
  });

  // 10 bytes into a 4-byte buffer → slices 4/4/2 all delivered, then pause.
  onread.call(handle, 10, Buffer.from("0123456789"));

  expect(Buffer.concat(received).toString()).toBe("0123456789");
  expect(socket.bytesRead).toBe(10);
  expect(readStopCalls).toBe(1); // paused once, after the full chunk
});
