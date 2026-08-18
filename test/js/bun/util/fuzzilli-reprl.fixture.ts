// Drives the fuzzilli REPRL loop with in-process mocks for the control/data
// FDs so the real src/js/eval/fuzzilli-reprl.ts source can be exercised in a
// normal (non-fuzzilli) build. argv[2] selects the fuzzed payload to run first;
// a second payload then proves the loop is still alive. Every 4-byte write the
// wrapper makes to the control-write FD is reported on stdout.

import fs from "node:fs";
import path from "node:path";

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;

const reprlPath = path.join(import.meta.dir, "..", "..", "..", "..", "src", "js", "eval", "fuzzilli-reprl.ts");

const scenarios: Record<string, string> = {
  // The real process.execve prints an error and aborts the process (SIGABRT)
  // when exec fails, so the wrapper must stub it out before running payloads.
  execve: `process.execve("fuzzilli-reprl-execve-does-not-exist", []);`,
  // Evaluates the wrapper a second time on the main thread, like
  // require(Bun.main + "?x") does under the fuzzer. The second copy must not
  // send another HELO or read from the control FD.
  reenter: `require(${JSON.stringify(reprlPath)});`,
};

const payloads = [
  Buffer.from(scenarios[process.argv[2]], "utf8"),
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

// Control-write pipe (fd 101): "HELO" for a handshake, otherwise the REPRL
// status word (exit code << 8) written after each payload.
const controlWrites: string[] = [];

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
    const bytes = Buffer.from(buffer);
    controlWrites.push(bytes.toString() === "HELO" ? "HELO" : `status=${bytes.readUInt32LE(0)}`);
    return bytes.length;
  }
  return (realWriteSync as any).call(fs, fd, buffer, ...rest);
};

(globalThis as any).resetCoverage = () => {};
(globalThis as any).require = require;

let thrown = "";
try {
  (0, eval)(fs.readFileSync(reprlPath, "utf8"));
} catch (e) {
  thrown = ` THREW=${(e as Error).message}`;
}

console.log(`CONTROL_WRITES=${controlWrites.join(",")} LIVE=${(globalThis as any).stillAlive === true}${thrown}`);
