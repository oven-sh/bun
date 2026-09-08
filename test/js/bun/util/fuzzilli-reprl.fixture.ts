// Drives the fuzzilli REPRL loop with in-process mocks for the control/data
// FDs so the real src/js/eval/fuzzilli-reprl.ts source can be exercised in a
// normal (non-fuzzilli) build.
//
// argv[2] is a JSON array of payload scripts. Each one is fed to the loop as
// one exec cycle, then the control pipe reports EOF, on which the loop exits
// the process. On exit the fixture prints one `REPRL_FIXTURE_RESULT=` line
// with the status the loop wrote for each payload and the value of
// `globalThis.probe` at the time of each status write.

import fs from "node:fs";
import path from "node:path";

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;

const payloads = (JSON.parse(process.argv[2]) as string[]).map(source => Buffer.from(source, "utf8"));

// Script the control-read pipe (fd 100): HELO handshake, then one exec cycle
// per payload (each followed by the 8-byte length), then EOF.
const controlChunks: Buffer[] = [Buffer.from("HELO")];
for (const payload of payloads) {
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(payload.length), 0);
  controlChunks.push(Buffer.from("exec"));
  controlChunks.push(size);
}
let controlStream = Buffer.concat(controlChunks);

// Data-read pipe (fd 102): the payload for each exec cycle.
let dataStream = Buffer.concat(payloads);

const statuses: number[] = [];
const probes: unknown[] = [];

const realFstatSync = fs.fstatSync;
const realReadSync = fs.readSync;
const realWriteSync = fs.writeSync;

(fs as any).fstatSync = function (fd: any, ...rest: any[]) {
  if (fd === REPRL_CRFD) return {} as any;
  return (realFstatSync as any).call(fs, fd, ...rest);
};

(fs as any).readSync = function (fd: any, buffer: any, offset: any, length: any, position: any) {
  if (fd === REPRL_CRFD) {
    const n = Math.min(length, controlStream.length);
    controlStream.copy(buffer, offset, 0, n);
    controlStream = controlStream.subarray(n);
    return n;
  }
  if (fd === REPRL_DRFD) {
    const n = Math.min(length, dataStream.length);
    dataStream.copy(buffer, offset, 0, n);
    dataStream = dataStream.subarray(n);
    return n;
  }
  return (realReadSync as any).call(fs, fd, buffer, offset, length, position);
};

(fs as any).writeSync = function (fd: any, buffer: any, ...rest: any[]) {
  if (fd === REPRL_CWFD) {
    if (Buffer.isBuffer(buffer) && buffer.length === 4 && buffer.toString() !== "HELO") {
      statuses.push(buffer.readUInt32LE(0));
      probes.push(structuredClone((globalThis as any).probe ?? null));
    }
    return Buffer.isBuffer(buffer) ? buffer.length : String(buffer).length;
  }
  return (realWriteSync as any).call(fs, fd, buffer, ...rest);
};

(globalThis as any).resetCoverage = () => {};
(globalThis as any).require = require;

process.on("exit", () => {
  realWriteSync.call(fs, 1, `REPRL_FIXTURE_RESULT=${JSON.stringify({ statuses, probes })}\n`);
});

await import(path.join(import.meta.dir, "..", "..", "..", "..", "src", "js", "eval", "fuzzilli-reprl.ts"));
