import { expect, test } from "bun:test";
import { StringDecoder } from "node:string_decoder";

// UTF-8 → UTF-16 conversion sizes its output buffer from a first pass over the
// input and then converts in a second pass. A Worker mutating a SharedArrayBuffer
// between passes (e.g. 3-byte '€' sequences → ASCII) makes the second pass write
// more code units than were allocated. The fix snapshots shared input before
// conversion, so these calls must never crash regardless of what the Worker does.

const SIZE = 3 * 64 * 1024;
const ITERS = 1000;

const workerSrc = `
self.onmessage = (e) => {
  const u8 = new Uint8Array(e.data);
  self.postMessage("ready");
  while (true) {
    for (let i = 0; i < u8.length; i += 3) { u8[i] = 0xE2; u8[i+1] = 0x82; u8[i+2] = 0xAC; }
    for (let i = 0; i < u8.length; i++) u8[i] = 0x41;
  }
};
`;

async function startRacingWorker(sab: SharedArrayBuffer): Promise<Worker> {
  const worker = new Worker(URL.createObjectURL(new Blob([workerSrc])));
  const ready = new Promise<void>(resolve => {
    worker.onmessage = () => resolve();
  });
  worker.postMessage(sab);
  await ready;
  return worker;
}

function fillEuro(u8: Uint8Array) {
  for (let i = 0; i < u8.length; i += 3) {
    u8[i] = 0xe2;
    u8[i + 1] = 0x82;
    u8[i + 2] = 0xac;
  }
}

test("Buffer.prototype.toString('utf8') on SharedArrayBuffer does not crash under concurrent mutation", async () => {
  const sab = new SharedArrayBuffer(SIZE);
  fillEuro(new Uint8Array(sab));
  const worker = await startRacingWorker(sab);
  try {
    const buf = Buffer.from(sab);
    for (let i = 0; i < ITERS; i++) {
      const s = buf.toString("utf8");
      expect(typeof s).toBe("string");
    }
  } finally {
    worker.terminate();
  }
});

test("TextDecoder.prototype.decode on SharedArrayBuffer does not crash under concurrent mutation", async () => {
  const sab = new SharedArrayBuffer(SIZE);
  fillEuro(new Uint8Array(sab));
  const worker = await startRacingWorker(sab);
  try {
    const td = new TextDecoder("utf-8");
    const u8 = new Uint8Array(sab);
    for (let i = 0; i < ITERS; i++) {
      const s = td.decode(u8);
      expect(typeof s).toBe("string");
    }
  } finally {
    worker.terminate();
  }
});

test("StringDecoder.prototype.write on SharedArrayBuffer does not crash under concurrent mutation", async () => {
  const sab = new SharedArrayBuffer(SIZE);
  fillEuro(new Uint8Array(sab));
  const worker = await startRacingWorker(sab);
  try {
    const sd = new StringDecoder("utf8");
    const buf = Buffer.from(sab);
    for (let i = 0; i < ITERS; i++) {
      const s = sd.write(buf);
      expect(typeof s).toBe("string");
    }
  } finally {
    worker.terminate();
  }
});

test("http_parser.execute rejects SharedArrayBuffer-backed input", () => {
  const binding = process.binding("http_parser");
  const HTTPParser = binding.HTTPParser;
  const parser = new HTTPParser();
  parser.initialize(HTTPParser.REQUEST, {});
  const sab = new SharedArrayBuffer(64);
  new Uint8Array(sab).set(Buffer.from("GET / HTTP/1.1\r\nHost: a\r\n\r\n"));
  expect(() => parser.execute(Buffer.from(sab))).toThrow(/SharedArrayBuffer/);
});
