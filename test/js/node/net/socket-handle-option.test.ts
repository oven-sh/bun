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
