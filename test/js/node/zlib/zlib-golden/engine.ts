// Calls the native handle of a node:zlib stream the way the stream does, but on this thread, which is many times faster.
import zlib from "node:zlib";

export const { Z_NO_FLUSH, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH, Z_BLOCK } = zlib.constants;

export type Mode = "Deflate" | "DeflateRaw" | "Gzip" | "Inflate" | "InflateRaw" | "Gunzip" | "Unzip";

export class Engine {
  #stream: any;
  #chunk: Buffer;
  #used = 0;
  #output: Buffer[] = [];
  /** How many bytes it has taken, and how many it has given. */
  read = 0;
  written = 0;
  /** The code and the message. A stream cannot be used any more then. */
  error?: string;

  constructor(mode: Mode, options?: zlib.ZlibOptions) {
    this.#stream = new (zlib[mode] as any)(options);
    this.#stream._handle.onerror = (message: string, _: number, code: string) => (this.error = `${code} ${message}`);
    this.#chunk = Buffer.alloc(this.#stream._chunkSize);
  }

  /**
   * Whether all of `input` was taken. Unless it `drains`, it asks for no more output then, like the writers of PNG
   * files and of tarballs.
   */
  write(input: Uint8Array, flush: number = Z_NO_FLUSH, drains = true) {
    const [handle, state, chunk] = [this.#stream._handle, this.#stream._writeState, this.#chunk];
    let left = input.length;
    for (let room = 0; room === 0 && (drains || left !== 0);) {
      handle.writeSync(flush, input, input.length - left, left, chunk, this.#used, chunk.length - this.#used);
      if (this.error) return false;
      this.read += left - state[1];
      this.written += chunk.length - this.#used - state[0];
      [room, left] = state;
      this.#used = chunk.length - room;
      if (room === 0) {
        this.#output.push(Buffer.from(chunk));
        this.#used = 0;
      }
    }
    return left === 0;
  }

  params(level: number, strategy: number, flushes = true) {
    if (flushes) this.write(nothing, Z_SYNC_FLUSH);
    this.#stream._handle.params(level, strategy);
  }

  /** Where a stream stops if nobody reads from it. The output is dropped. */
  writeUntilFull(input: Uint8Array, room = 64) {
    this.#stream._handle.writeSync(Z_NO_FLUSH, input, 0, input.length, Buffer.alloc(room), 0, room);
  }

  reset() {
    this.#stream.reset();
  }

  get output() {
    return Buffer.concat([...this.#output, this.#chunk.subarray(0, this.#used)]);
  }

  [Symbol.dispose]() {
    this.#stream.close();
  }
}

export const nothing = Buffer.alloc(0);

/** The last piece goes with Z_FINISH, as for `end(piece)`. Stops where a stream would: at an error or at its end. */
export function inflate(mode: Mode, pieces: Iterable<Uint8Array>, options?: zlib.ZlibOptions) {
  using engine = new Engine(mode, options);
  const all = [...pieces];
  all.every((piece, i) => engine.write(piece, i === all.length - 1 ? Z_FINISH : Z_NO_FLUSH));
  return { output: engine.output, read: engine.read, error: engine.error };
}

export function* piecesOf(data: Uint8Array, size: number | (() => number)) {
  let at = 0;
  do {
    const end = at + (typeof size === "number" ? size : size());
    yield data.subarray(at, end);
    at = end;
  } while (at < data.length);
}

export const streamOf = (pieces: Iterable<Uint8Array>) =>
  new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });
