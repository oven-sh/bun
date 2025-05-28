import { Writable } from "node:stream";

class WrapStream extends Writable {
  #base;
  #message;

  constructor(base, message) {
    super();
    this.#base = base;
    this.#message = message;
  }

  _write(chunk, encoding, callback) {
    const string = chunk.toString("utf8");
    this.#base.write(`[${this.#message}] ${string}`, "utf8", callback);
  }
}
if (Bun.isMainThread) {
  process.stdout = new WrapStream(process.stdout, "parent process.stdout");
  process.stderr = new WrapStream(process.stderr, "parent process.stderr");
  new Worker(import.meta.filename);
} else {
  process.stdout = new WrapStream(process.stdout, "worker process.stdout");
  process.stderr = new WrapStream(process.stderr, "worker process.stderr");

  console.assert();
  console.assert(false);
  // TODO: https://github.com/oven-sh/bun/issues/19953
  // this should be "Assertion failed: should be true," not "should be true"
  // but we still want to make sure it is not in workers
  console.assert(false, "should be true");
  console.debug("debug");
  console.error("error");
  console.info("info");
  console.log("log");
  console.table([{ a: 5 }]);
  // TODO: https://github.com/oven-sh/bun/issues/19952
  // this goes to the wrong place but we still want to make sure it is not in workers
  console.trace("trace");
  console.warn("warn");
}
