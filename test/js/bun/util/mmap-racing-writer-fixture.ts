// Fixture for "a mapping that another thread writes" in mmap.test.js.
//
//   bun mmap-racing-writer-fixture.ts <consumer> <file> <calls> <view | transferred | private>
//
// The main thread maps <file> and gives the view to <consumer> again and again. A worker maps the same file and keeps
// rewriting it, as another process that has the file open can. Every consumer here reads a byte more than once and
// counts on what it was: a parser scans ahead and comes back, a UTF-8 decoder sizes its output in one pass and fills it
// in a second. So each has to read a copy of a mapping, as it does of a SharedArrayBuffer. One that reads the mapping
// in place aborts, writes out of bounds (a sanitizer build reports it) or returns a result that contradicts itself.
// Prints "done" after <calls> calls that ran while the worker wrote.
//
// The last argument is how the main thread holds the mapping: the view that Bun.mmap returns, a view of the buffer that
// `transfer()` moved the mapping to, or a private mapping (which on Linux shows what is written to the file until the
// process writes that page itself).
import { transcode } from "node:buffer";
import { writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { isMainThread, Worker, workerData } from "node:worker_threads";

type Race = {
  /** What the file holds before the worker starts. */
  bytes: Uint8Array;
  /** One pass of the worker over its mapping. A pass with `odd` false puts `bytes` back. */
  write(mapped: Uint8Array, odd: boolean): void;
  /** One call. It can throw what the consumer throws for bytes that are not a document. */
  read(mapped: Uint8Array): unknown;
};

const encode = (text: string) => new TextEncoder().encode(text);

/** Writes one document over the whole file, then another of the same length. */
function alternating(even: Uint8Array, odd: Uint8Array, read: Race["read"]): Race {
  if (even.length !== odd.length) throw new Error("the two documents differ in length");
  return { bytes: even, write: (mapped, isOdd) => void mapped.set(isOdd ? odd : even), read };
}

/** Fills the whole file with one byte, then with another: a byte that is read twice differs. */
function filled(length: number, even: string | number, odd: string | number, read: Race["read"]): Race {
  const byte = (value: string | number) => (typeof value === "number" ? value : value.charCodeAt(0));
  return alternating(new Uint8Array(length).fill(byte(even)), new Uint8Array(length).fill(byte(odd)), read);
}

/** Changes the bytes of `text` that `flip` gives another value for, and changes them back. */
function flipped(text: string, flip: (byte: number, at: number) => number, read: Race["read"]): Race {
  const bytes = encode(text);
  const at: number[] = [];
  bytes.forEach((byte, index) => flip(byte, index) !== byte && at.push(index));
  return {
    bytes,
    write: (mapped, isOdd) => {
      for (const index of at) mapped[index] = isOdd ? flip(bytes[index], index) : bytes[index];
    },
    read,
  };
}

/** Parses, and lets the parser say that the bytes are not a document. */
const parsed = (parse: (mapped: Uint8Array) => unknown) => (mapped: Uint8Array) => {
  try {
    parse(mapped);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
};

const stringDecoder = new StringDecoder("utf8");
const textDecoder = new TextDecoder();
const textDecoderStream = new TextDecoderStream();
const streamWriter = textDecoderStream.writable.getWriter();
const streamReader = textDecoderStream.readable.getReader();
let decodes = 0;

const races: Record<string, Race> = {
  // Every "a" of a name becomes a "b" and back, so the document stays well-formed. A key is hashed from one read of the
  // name and copied from another.
  "Bun.XML.parse": flipped(
    "<r>" + Buffer.alloc(550, "<aaaaaaaa/>").toString() + "</r>",
    (byte, at) => (byte === 0x61 && at > 2 ? 0x62 : byte),
    mapped => {
      const { r } = Bun.XML.parse(mapped) as { r: Record<string, unknown> };
      for (const key of Object.keys(r)) {
        if (!Object.hasOwn(r, key.split("").join(""))) throw new Error(`an equal string doesn't find the key ${key}`);
      }
    },
  ),
  // A string that is not ASCII is measured as UTF-16 in one pass and converted in a second. "€" is three bytes and one
  // unit, and three bytes of "x" are three units.
  "Bun.TOML.parse": alternating(
    encode(`a = "${Buffer.alloc(6000, "€")}"\n`),
    encode(`a = "${Buffer.alloc(6000, "x")}"\n`),
    parsed(Bun.TOML.parse),
  ),
  "Bun.YAML.parse": filled(1 << 11, "\n", "-", parsed(Bun.YAML.parse)),
  // The block parser sees "#", starts the heading text after it, then looks for the end of the line from the "#" again.
  // A newline there ends the line before the text starts.
  "Bun.markdown.html": flipped(
    "# heading\n\nparagraph\n",
    (byte, at) => (at === 0 ? 0x0a : byte),
    mapped => Bun.markdown.html(mapped),
  ),
  // The length pass of a UTF-8 decoder counts no UTF-16 unit for a 0x80 byte. If the byte is 0x61 by the conversion pass,
  // that pass writes one more unit than was allocated. The file is long enough that a result is not allocated in the
  // JavaScript heap, where a sanitizer sees no overflow.
  "UTF-8 decoders": filled(2048, 0x61, 0x80, async mapped => {
    const chunk = decodes++ & 1 ? mapped : mapped.buffer;
    textDecoder.decode(chunk);
    Buffer.from(mapped.buffer).toString("utf8");
    stringDecoder.write(mapped as Buffer);
    stringDecoder.text(mapped as Buffer, 0);
    stringDecoder.end(mapped as Buffer);
    try {
      transcode(mapped, "utf8", "ucs2");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "U_INVALID_CHAR_FOUND") throw error;
    }
    streamWriter.write(chunk);
    await streamReader.read();
    let chunks = 0;
    const source = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunks & 1 ? mapped : mapped.buffer);
        if (++chunks === 2) controller.close();
      },
    });
    for await (const _ of new Response(source).textStream());
  }),
};

const [consumer, file, calls, held] = [process.argv[2], process.argv[3], Number(process.argv[4]), process.argv[5]];
const race = races[consumer];

if (isMainThread) {
  writeFileSync(file, race.bytes);
  const mapped =
    held === "transferred"
      ? new Uint8Array(Bun.mmap(file).buffer.transfer())
      : Bun.mmap(file, { shared: held !== "private" });

  // The number of passes the worker has made over the file.
  const passes = new Int32Array(new SharedArrayBuffer(4));
  new Worker(new URL(import.meta.url), { workerData: passes, argv: [consumer, file, String(calls), held] }).unref();

  // The worker's events cannot reach this thread while it calls the consumer in a loop, so a worker that stopped shows
  // only as a pass count that stands still.
  const workerStopped = (): never => {
    console.error("the worker made no pass over the file for 10 s");
    process.exit(1);
  };
  if (Atomics.wait(passes, 0, 0, 10_000) === "timed-out") workerStopped();

  // Count a call only when the worker made a pass while it ran. A debug build is slow enough that every call counts. A
  // release build can make a thousand calls before the worker's thread gets a core of its own.
  let seen = Atomics.load(passes, 0);
  let progressAt = performance.now();
  for (let overlapped = 0; overlapped < calls;) {
    await race.read(mapped);
    const now = Atomics.load(passes, 0);
    if (now !== seen) {
      seen = now;
      overlapped++;
      progressAt = performance.now();
    } else if (performance.now() - progressAt > 10_000) {
      workerStopped();
    }
  }

  console.log("done");
  process.exit(0);
} else {
  const passes = workerData as Int32Array;
  const mapped = Bun.mmap(file);
  for (let pass = 1; ; pass++) {
    race.write(mapped, (pass & 1) === 1);
    if (Atomics.add(passes, 0, 1) === 0) Atomics.notify(passes, 0);
  }
}
