const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hasOwn = Object.prototype.hasOwnProperty;

function writeOnPrototype(stream) {
  // This is exactly the check pino/sonic-boom's hasBeenTampered() performs.
  return stream.write === stream.constructor.prototype.write;
}

const file = path.join(os.tmpdir(), `bun-write-on-prototype-${process.pid}.txt`);
// A regular (non-fast-path) WriteStream: write() now lives on WriteStream.prototype
// for every instance, so the invariant and the Writable.prototype.write fallback
// must both hold here as well.
const ws = fs.createWriteStream(file);

const result = {
  stdoutWriteOnPrototype: writeOnPrototype(process.stdout),
  stdoutNoOwnWrite: !hasOwn.call(process.stdout, "write"),
  stderrWriteOnPrototype: writeOnPrototype(process.stderr),
  stderrNoOwnWrite: !hasOwn.call(process.stderr, "write"),
  writeStreamWriteOnPrototype: writeOnPrototype(ws),
  writeStreamNoOwnWrite: !hasOwn.call(ws, "write"),
  wrote: "",
};

ws.end("hello from write stream", () => {
  result.wrote = fs.readFileSync(file, "utf8");
  fs.unlinkSync(file);
  process.stdout.write(JSON.stringify(result));
});
