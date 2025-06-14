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
  process.stdout.write("stdout");
  process.stderr.write("stderr");
}
