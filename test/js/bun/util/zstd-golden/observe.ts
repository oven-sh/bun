// What Bun's zstd makes of a case, as text, and how that differs from what was recorded.
import { join } from "node:path";
import zlib from "node:zlib";
import { differences } from "../../archive-golden/observe";
import { make, type Source } from "./source";

type Options = { params?: Record<number, number>; pledgedSrcSize?: number };

type Api =
  /** `Bun.zstdCompressSync()`, `Bun.zstdDecompressSync()` */
  | { level: number }
  /** `CompressionStream`, `DecompressionStream` */
  | { level: number; highWaterMark: number; chunk: number }
  /** Calls of the `node:zlib` handle. With 16 added to `flush`, a call gets none of the input that is waiting. */
  | (Options & { calls: [added: number, room: number, flush: number, times: number][] })
  /** The same, each repeated until it is through. With workers it depends on timing how often that is. */
  | (Options & { room: number; writes: [added: number, flush: number][] });

type Encode = Source & Api;
export type EncodeCase = Encode & { name: string; result: string };
export type DecodeCase = Api & { name: string; result: string } & (
    { frames: string; dictionary?: string } | { encoded: Encode; edits: [position: number, xor: number][]; cut: number }
  );
export type Cases = { encode: EncodeCase[]; decode: DecodeCase[] };

export { inParts } from "../../image/webp-golden/observe";

export const fixture = join(import.meta.dir, "cases.json.gz");

export async function loadCases(): Promise<Cases> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(fixture).bytes())).toString());
}

/** For errors that have no number of their own. */
const numbers: Record<string, number> = {
  "Decompression failed: InvalidZstdData": 251,
  "Decompression failed: DecompressionFailed": 252,
  "Decompression failed: ZstdDecompressionError": 253,
  "zstd decode failed": 253,
  "unexpected end of file": 254,
  "Trailing junk found after the end of the compressed stream": 254,
  "Setting parameter failed": 255,
  "Failed to load zstd dictionary": 255,
};

type Outcome = { error: number; output: Uint8Array; counts?: number };

function failed(error: any): Outcome {
  if (!Object.hasOwn(numbers, error.message)) throw error;
  return { error: numbers[error.message], output: new Uint8Array() };
}

function handle(Class: any, api: Api & Options, input: Uint8Array, dictionary: Uint8Array): Outcome {
  let stream;
  try {
    stream = new Class({ params: api.params, pledgedSrcSize: api.pledgedSrcSize, dictionary });
  } catch (error) {
    return failed(error);
  }
  let error = 0;
  stream._handle.onerror = (_: string, errno: number) => (error = errno);

  const output: Uint8Array[] = [];
  let position = 0;
  let available = 0;
  let counts = 0;
  function write(added: number, room: number, flush: number) {
    available = Math.min(available + added, input.length);
    const length = flush & 16 ? 0 : available - position;
    const out = Buffer.allocUnsafe(room);
    stream._handle.writeSync(flush & 3, input, position, length, out, 0, room);
    const [roomLeft, inputLeft] = error ? [room, length] : stream._writeState;
    position += length - inputLeft;
    output.push(out.subarray(0, room - roomLeft));
    counts = Math.imul(Math.imul(counts ^ inputLeft, 0x01000193) ^ roomLeft, 0x01000193) >>> 0;
    return roomLeft;
  }

  if ("calls" in api) {
    for (const [added, room, flush, times] of api.calls) {
      for (let i = 0; i < times && !error; i++) write(added, room, flush);
    }
  } else if ("writes" in api) {
    for (const [added, flush] of api.writes) {
      let roomLeft = write(added, api.room, flush);
      while (!error && (position < available || (flush && !roomLeft))) roomLeft = write(0, api.room, flush);
    }
    counts = 0;
    if (error) output.length = 0;
  }
  stream.close();
  return { error, output: Buffer.concat(output), counts };
}

async function web(stream: CompressionStream | DecompressionStream, input: Uint8Array, chunk: number) {
  const writer = stream.writable.getWriter();
  for (let i = 0; i < input.length; i += chunk) writer.write(input.subarray(i, i + chunk)).catch(() => {});
  writer.close().catch(() => {});
  try {
    return { error: 0, output: await new Response(stream.readable).bytes() };
  } catch (error) {
    return failed(error);
  }
}

async function encode(c: Encode): Promise<Outcome> {
  const { input, dictionary } = make(c);
  if ("chunk" in c) return web(new (CompressionStream as any)("zstd", c), input, c.chunk);
  if ("level" in c) return { error: 0, output: Bun.zstdCompressSync(input, c) };
  return handle(zlib.ZstdCompress, c, input, dictionary);
}

async function decode(c: DecodeCase): Promise<Outcome> {
  let input: Uint8Array, dictionary: Uint8Array;
  if ("frames" in c) {
    input = Buffer.from(c.frames, "base64");
    dictionary = Buffer.from(c.dictionary ?? "", "base64");
  } else {
    input = (await encode(c.encoded)).output;
    for (const [position, xor] of c.edits) input[position % input.length] ^= xor;
    input = input.subarray(0, Math.max(0, input.length - c.cut));
    dictionary = make(c.encoded).dictionary;
  }
  if ("chunk" in c) return web(new (DecompressionStream as any)("zstd", c), input, c.chunk);
  if (!("level" in c)) return handle(zlib.ZstdDecompress, c, input, dictionary);
  try {
    return { error: 0, output: Bun.zstdDecompressSync(input) };
  } catch (error) {
    return failed(error);
  }
}

const hex = (n: number | bigint, digits: number) => n.toString(16).padStart(digits, "0");

/** The error, the length and the hash of the output, and a hash of what each call left of the input and the room. */
const text = ({ error, output, counts = 0 }: Outcome) =>
  `${error} ${output.length} ${hex(Bun.hash.xxHash64(output), 16)} ${hex(counts, 8)}`;

export const observeEncode = async (c: EncodeCase) => text(await encode(c));
export const observeDecode = async (c: DecodeCase) => text(await decode(c));

async function differencesOf<T extends { name: string; result: string }>(
  cases: T[],
  observe: (c: T) => Promise<string>,
) {
  const results = [];
  for (const c of cases) results.push({ index: c.name, expected: c.result + "\n", actual: (await observe(c)) + "\n" });
  return differences(results);
}

export const encodeDifferences = (cases: EncodeCase[]) => differencesOf(cases, observeEncode);
export const decodeDifferences = (cases: DecodeCase[]) => differencesOf(cases, observeDecode);
