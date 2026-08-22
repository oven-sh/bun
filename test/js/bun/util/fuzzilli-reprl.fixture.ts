// Drives the fuzzilli REPRL loop (src/js/eval/fuzzilli-reprl.ts) in a normal,
// non-fuzzilli build by mocking the REPRL control/data FDs on node:fs.
//
// argv[2] is a JSON array of programs. Each one is fed to the loop as one exec
// cycle, then the control FD reports EOF. Programs record what ran by pushing
// markers onto the global `ran` array. Every time the loop reports a program's
// status, one line is printed with the REPRL status word (exit code in bits
// 8..15) and the markers recorded so far, and the markers are cleared: each
// line shows exactly what had run by the time that program's status went back
// to the fuzzer.

import fs from "node:fs";
import path from "node:path";

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;

const programs: string[] = JSON.parse(process.argv[2]);

// Control pipe (fd 100): HELO, then "exec" + u64le length per program, then EOF.
const controlChunks: Buffer[] = [Buffer.from("HELO")];
// Data pipe (fd 102): the program sources, in order.
const dataChunks: Buffer[] = [];
for (const program of programs) {
  const source = Buffer.from(program, "utf8");
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(source.length), 0);
  controlChunks.push(Buffer.from("exec"), size);
  dataChunks.push(source);
}
const streams = new Map<number, Buffer>([
  [REPRL_CRFD, Buffer.concat(controlChunks)],
  [REPRL_DRFD, Buffer.concat(dataChunks)],
]);

const ran: string[] = [];
(globalThis as any).ran = ran;
(globalThis as any).resetCoverage = () => {};
(globalThis as any).require = require;

// Programs may replace console.log; the status lines must still come out.
const log = console.log.bind(console);

const realFstatSync = fs.fstatSync;
const realReadSync = fs.readSync;
const realWriteSync = fs.writeSync;

(fs as any).fstatSync = function (fd: number, ...rest: any[]) {
  if (fd === REPRL_CRFD) return {};
  return (realFstatSync as any).call(fs, fd, ...rest);
};

(fs as any).readSync = function (fd: number, buffer: Buffer, offset: number, length: number, ...rest: any[]) {
  const stream = streams.get(fd);
  if (stream === undefined) return (realReadSync as any).call(fs, fd, buffer, offset, length, ...rest);
  const n = Math.min(length, stream.length);
  stream.copy(buffer, offset, 0, n);
  streams.set(fd, stream.subarray(n));
  return n;
};

let sawHelo = false;
(fs as any).writeSync = function (fd: number, buffer: Buffer, ...rest: any[]) {
  if (fd !== REPRL_CWFD) return (realWriteSync as any).call(fs, fd, buffer, ...rest);
  if (!sawHelo) {
    sawHelo = true;
  } else {
    log(`status=0x${buffer.readUInt32LE(0).toString(16)} ran=${JSON.stringify([...ran].sort())}`);
    ran.length = 0;
  }
  return buffer.length;
};

const reprlSource = fs.readFileSync(
  path.join(import.meta.dir, "..", "..", "..", "..", "src", "js", "eval", "fuzzilli-reprl.ts"),
  "utf8",
);
(0, eval)(reprlSource);
