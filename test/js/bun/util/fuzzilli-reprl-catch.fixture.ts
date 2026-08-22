// Drives the fuzzilli REPRL loop with in-process mocks for the control/data
// FDs so the real src/js/eval/fuzzilli-reprl.ts source can be exercised in a
// normal (non-fuzzilli) build. Feeds a payload that throws a value whose
// Symbol.toPrimitive returns a non-primitive and verifies the loop survives.

import fs from "node:fs";
import path from "node:path";

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;

const payload = Buffer.from(
  `
function F20() {}
F20[Symbol.toPrimitive] = () => F20;
throw F20;
`,
  "utf8",
);

// Script the control-read pipe (fd 100): HELO handshake, then two exec cycles
// (each followed by the 8-byte length), then EOF.
const controlChunks: Buffer[] = [Buffer.from("HELO")];
const size = Buffer.alloc(8);
size.writeBigUInt64LE(BigInt(payload.length), 0);
for (let i = 0; i < 2; i++) {
  controlChunks.push(Buffer.from("exec"));
  controlChunks.push(Buffer.from(size));
}
let controlStream = Buffer.concat(controlChunks);

// Data-read pipe (fd 102): the payload for each exec cycle.
let dataStream = Buffer.concat([payload, payload]);

let statusWrites = 0;

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
      statusWrites++;
    }
    return Buffer.isBuffer(buffer) ? buffer.length : String(buffer).length;
  }
  return (realWriteSync as any).call(fs, fd, buffer, ...rest);
};

(globalThis as any).resetCoverage = () => {};
(globalThis as any).require = require;

process.once("uncaughtException", err => {
  // If the catch block lets an exception escape, the REPRL loop never reaches
  // the status write and we land here instead.
  realWriteSync.call(fs, 2, `UNCAUGHT:${err && (err as any).message}\n`);
  realWriteSync.call(fs, 1, `STATUS_WRITES=${statusWrites}\n`);
  process.exit(1);
});

const reprlSource = fs.readFileSync(
  path.join(import.meta.dir, "..", "..", "..", "..", "src", "js", "eval", "fuzzilli-reprl.ts"),
  "utf8",
);
(0, eval)(reprlSource);

realWriteSync.call(fs, 1, `STATUS_WRITES=${statusWrites}\n`);
process.exit(statusWrites === 2 ? 0 : 1);
