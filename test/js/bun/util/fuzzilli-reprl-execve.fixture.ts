// Drives the fuzzilli REPRL loop with in-process mocks for the control/data
// FDs so the real src/js/eval/fuzzilli-reprl.ts source can be exercised in a
// normal (non-fuzzilli) build. Feeds a payload that calls process.execve with
// a nonexistent path: the real implementation prints an error and aborts the
// process (SIGABRT) when exec fails, so the REPRL wrapper must stub it out
// before running fuzzed scripts.

import fs from "node:fs";
import path from "node:path";

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;

const payloads = [
  Buffer.from(`process.execve("fuzzilli-reprl-execve-does-not-exist", []);`, "utf8"),
  Buffer.from(`globalThis.stillAlive = true;`, "utf8"),
];

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

const reprlSource = fs.readFileSync(
  path.join(import.meta.dir, "..", "..", "..", "..", "src", "js", "eval", "fuzzilli-reprl.ts"),
  "utf8",
);
(0, eval)(reprlSource);

const liveAfterExecve = (globalThis as any).stillAlive === true;
realWriteSync.call(fs, 1, `STATUS_WRITES=${statusWrites} LIVE=${liveAfterExecve}\n`);
process.exit(statusWrites === 2 && liveAfterExecve ? 0 : 1);
