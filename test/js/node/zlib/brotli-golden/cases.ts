// The inputs of brotli-golden.test.ts, and how a case is run. Everything is derived from seeds, so
// that the fixtures only have to hold what came out.
import { createCipheriv, createHash } from "node:crypto";
import zlib from "node:zlib";

const c = zlib.constants;

/** mulberry32 */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    next,
    below: (n: number) => (n <= 0 ? 0 : next() % n),
    range: (lo: number, hi: number) => lo + (next() % (hi - lo + 1)),
    chance: (num: number, den: number) => next() % den < num,
    pick: <T>(list: readonly T[]) => list[next() % list.length],
  };
}
type Rng = ReturnType<typeof prng>;

// Many of these are in the built-in dictionary, as they are or transformed.
const words =
  "the of and to a in is that for it was with as his on be at by had not are but from or have an they which one you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three information Internet function return http:// https:// <div> </div> class= style= href= JavaScript window.location document.getElementById"
    .split(" ")
    .concat(["é", "ü", "中文", "日本語", "русский", "العربية", "한국어", "\n", ". ", ", ", '="', "</", "/>", "  "]);

export const kinds = [
  "zeros",
  "random",
  "text",
  "Text",
  "html",
  "json",
  "ints",
  "period",
  "letters",
  "utf8",
  "near-random",
  "copies",
  "mixed",
] as const;
export type Kind = (typeof kinds)[number];
export type Input = { kind: Kind; seed: number; length: number };

const separators = [" ", " ", " ", ", ", ". ", "\n", "(", '"', "'", "=", ":"];
const tags = ["div", "span", "a", "p", "li", "td", "script", "h1"];
const scripts = [0x430, 0x4e00, 0x3040, 0x5d0, 0x1f600];

const encoded = new Map<string, Buffer>();

function fill(out: Buffer, start: number, end: number, kind: Kind, r: Rng) {
  /** A piece comes in parts that recur, as making a string or a Buffer takes long in a debug build. */
  const put = (piece: () => (string | Buffer)[]) => {
    for (let at = start; at < end;) {
      const parts = piece();
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        let b = typeof p === "string" ? encoded.get(p) : p;
        if (b === undefined) encoded.set(p as string, (b = Buffer.from(p)));
        at += b.copy(out, at, 0, Math.min(b.length, end - at));
      }
    }
  };
  switch (kind) {
    case "zeros":
      return void out.fill(r.chance(1, 2) ? 0 : r.below(256), start, end);
    case "random":
      for (let i = start; i < end; i++) out[i] = r.next();
      return;
    case "near-random":
      for (let i = start; i < end; i++) out[i] = r.chance(1, 20) ? 0x20 : r.next();
      return;
    case "text":
      return put(() => [r.pick(words), " "]);
    case "Text":
      return put(() => {
        const w = r.pick(words);
        return r.chance(1, 4)
          ? [w[0].toUpperCase(), w.slice(1), r.pick(separators)]
          : [r.chance(1, 20) ? w.toUpperCase() : w, r.pick(separators)];
      });
    case "html":
      return put(() => {
        const tag = r.pick(tags);
        // prettier-ignore
        return ["<", tag, ' class="', r.pick(words), '" id="n', `${r.below(50)}`, '">', r.pick(words), " ", r.pick(words), "</", tag, ">\n"];
      });
    case "json":
      // prettier-ignore
      return put(() => ['{"id":', `${r.below(100000)}`, ',"name":"', r.pick(words), '","ok":', `${r.chance(1, 2)}`, ',"v":[', `${r.below(10)}`, ",", `${r.below(10)}`, "]},"]);
    case "ints": {
      let v = r.next();
      const step = r.range(1, 9);
      return put(() => {
        v = (v + r.below(step)) >>> 0;
        const b = Buffer.alloc(4);
        b.writeUInt32LE(v);
        return [b];
      });
    }
    case "period": {
      const pattern = Buffer.alloc(r.range(1, 70));
      for (let i = 0; i < pattern.length; i++) pattern[i] = r.next();
      return put(() => [pattern]);
    }
    case "letters": {
      const n = r.range(2, 20);
      for (let i = start; i < end; i++) out[i] = 97 + r.below(n);
      return;
    }
    case "utf8":
      return put(() => [String.fromCodePoint(r.pick(scripts) + r.below(40)), r.chance(1, 5) ? " " : ""]);
    case "copies":
      for (let i = start; i < end;) {
        if (i > 8 && r.chance(3, 4)) {
          const distance = r.chance(1, 3) ? r.range(1, Math.min(i, 16)) : r.range(1, i);
          for (let n = r.range(2, 300); n > 0 && i < end; n--, i++) out[i] = out[i - distance];
        } else {
          for (let n = r.range(1, 12); n > 0 && i < end; n--, i++) out[i] = r.next();
        }
      }
      return;
    case "mixed":
      for (let i = start; i < end;) {
        const n = Math.min(end - i, r.range(1, Math.max(1, (end - start) >> 1)));
        fill(out, i, i + n, r.pick(kinds.filter(k => k !== "mixed")), r);
        i += n;
      }
      return;
  }
}

/** Deterministic noise, made natively: a loop over bytes takes very long in a debug build. */
const noise = (seed: number, length: number) => {
  const key = Buffer.alloc(16);
  key.writeUInt32LE(seed >>> 0);
  return createCipheriv("aes-128-ctr", key, Buffer.alloc(16)).update(Buffer.alloc(length));
};

/** The start is made byte by byte. The rest is made of pieces of what comes before it, with some noise in between. */
export function makeInput({ kind, seed, length }: Input) {
  if (kind === "random") return noise(seed, length);
  const out = Buffer.alloc(length);
  const r = prng(seed);
  const head = Math.min(length, 768);
  fill(out, 0, head, kind, r);
  if (kind === "zeros") return out.fill(out[0]);
  const spice = noise(seed, 4096);
  const far = r.chance(1, 2);
  for (let at = head; at < length;) {
    if (kind === "near-random" ? r.chance(9, 10) : r.chance(1, 12)) {
      const n = kind === "near-random" ? r.range(16, 2000) : r.range(1, 6);
      const from = r.below(spice.length - n);
      at += spice.copy(out, at, from, from + n);
    } else {
      const n = Math.min(r.chance(1, 8) ? r.range(4, 3000) : r.range(3, 120), at);
      const from = far ? r.below(at - n + 1) : Math.max(0, at - n - r.below(5000));
      out.copyWithin(at, from, from + n);
      at += n;
    }
  }
  return out;
}

export type EncoderCase = {
  input: Input;
  /** `BROTLI_PARAM_*` to value. */
  params: Record<number, number>;
  dictionary?: Input & { /** Take it from the input, at this offset. */ from?: number };
  chunkSize?: number;
  /** Write through a stream, in pieces of these sizes, each followed by this flush if it is not -1. */
  writes?: [size: number, flush: number][];
  /** Recorded: the length and the start of the SHA-256 of the output, or the error code. */
  result?: string;
};

function makeDictionary(input: Buffer, d: NonNullable<EncoderCase["dictionary"]>) {
  return d.from === undefined ? makeInput(d) : Buffer.from(input.subarray(d.from, d.from + d.length));
}

export const digest = (b: Uint8Array) => `${b.length} ${createHash("sha256").update(b).digest("hex").slice(0, 16)}`;

export async function encode(k: EncoderCase): Promise<Buffer> {
  const input = makeInput(k.input);
  const options: zlib.BrotliOptions & { dictionary?: Buffer } = { params: k.params };
  if (k.chunkSize) options.chunkSize = k.chunkSize;
  if (k.dictionary) options.dictionary = makeDictionary(input, k.dictionary);
  if (!k.writes) return zlib.brotliCompressSync(input, options);
  const stream = zlib.createBrotliCompress(options);
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => stream.on("end", resolve).on("error", reject));
  let at = 0;
  for (const [size, flush] of k.writes) {
    stream.write(input.subarray(at, at + size));
    at += size;
    if (flush !== -1) await Promise.race([done, new Promise<void>(resolve => stream.flush(flush, resolve))]);
  }
  stream.end(input.subarray(at));
  await done;
  return Buffer.concat(chunks);
}

export async function observeEncoder(k: EncoderCase) {
  try {
    return digest(await encode(k));
  } catch (e: any) {
    return `${e.code}`;
  }
}

export type DecoderCase = {
  /** base64 */
  stream: string;
  params?: Record<number, number>;
  /** base64 */
  dictionary?: string;
  chunkSize?: number;
  /** Write it through a stream, in pieces of this size. */
  pieces?: number;
  /** Recorded: the length and the start of the SHA-256 of the output, or the error. */
  result?: string;
};

async function decodeInPieces(input: Buffer, size: number, options: zlib.BrotliOptions) {
  const stream = zlib.createBrotliDecompress(options);
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => stream.on("end", resolve).on("error", reject));
  for (let at = 0; at < input.length; at += size) stream.write(input.subarray(at, at + size));
  stream.end();
  await done;
  return Buffer.concat(chunks);
}

export async function observeDecoder(k: DecoderCase) {
  const options: zlib.BrotliOptions & { dictionary?: Buffer } = { maxOutputLength: 1 << 24 };
  if (k.params) options.params = k.params;
  if (k.chunkSize) options.chunkSize = k.chunkSize;
  if (k.dictionary) options.dictionary = Buffer.from(k.dictionary, "base64");
  const input = Buffer.from(k.stream, "base64");
  try {
    return digest(
      k.pieces ? await decodeInPieces(input, k.pieces, options) : zlib.brotliDecompressSync(input, options),
    );
  } catch (e: any) {
    return `${e.code} ${e.errno} ${e.message}`;
  }
}

/** Sizes that are mostly small, since a debug build takes a while for the high qualities. */
function length(r: Rng, quality: number) {
  const most = quality >= 10 ? 20_000 : quality >= 5 ? 150_000 : 400_000;
  switch (r.below(8)) {
    case 0:
      return r.below(8);
    case 1:
      return r.below(100);
    case 2:
    case 3:
      return r.below(2_000);
    case 4:
    case 5:
    case 6:
      return r.below(most >> 3);
    default:
      return r.below(most);
  }
}

/** Values that the encoder replaces or refuses. */
const unusualEncoderParams: Record<number, number>[] = [
  { [c.BROTLI_PARAM_QUALITY]: 12 },
  { [c.BROTLI_PARAM_QUALITY]: 0x7fffffff },
  { [c.BROTLI_PARAM_LGWIN]: 0 },
  { [c.BROTLI_PARAM_LGWIN]: 9 },
  { [c.BROTLI_PARAM_LGWIN]: 25 },
  { [c.BROTLI_PARAM_LGWIN]: 31, [c.BROTLI_PARAM_LARGE_WINDOW]: 1 },
  { [c.BROTLI_PARAM_LARGE_WINDOW]: 2 },
  { [c.BROTLI_PARAM_LGBLOCK]: 15 },
  { [c.BROTLI_PARAM_LGBLOCK]: 25 },
  { [c.BROTLI_PARAM_MODE]: 3 },
  { [c.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING]: 0 },
  { [c.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING]: 2 },
  { [c.BROTLI_PARAM_SIZE_HINT]: 0xfffffffe },
  { [c.BROTLI_PARAM_NPOSTFIX]: 4 },
  { [c.BROTLI_PARAM_NPOSTFIX]: 2, [c.BROTLI_PARAM_NDIRECT]: 3 },
  { [c.BROTLI_PARAM_NPOSTFIX]: 3, [c.BROTLI_PARAM_NDIRECT]: 128 },
];

export function generateEncoderCases(count = 240, seed = 1) {
  const r = prng(seed);
  const text: Input = { kind: "Text", seed: 3, length: 3000 };
  const cases: EncoderCase[] = [{ input: text, params: {} }];
  for (const unusual of unusualEncoderParams) {
    cases.push({ input: text, params: { [c.BROTLI_PARAM_QUALITY]: 5, ...unusual } });
  }
  for (let quality = 0; quality < 12; quality++) {
    cases.push({
      input: { kind: "html", seed: 4, length: 2000 },
      params: { [c.BROTLI_PARAM_QUALITY]: quality },
      writes: [
        [0, c.BROTLI_OPERATION_EMIT_METADATA],
        [500, c.BROTLI_OPERATION_FLUSH],
        [500, c.BROTLI_OPERATION_PROCESS],
        [500, c.BROTLI_OPERATION_EMIT_METADATA],
      ],
    });
  }
  for (let i = 0; i < count; i++) {
    const quality = i % 12;
    const input: Input = { kind: r.pick(kinds), seed: r.next(), length: length(r, quality) };
    const params: Record<number, number> = { [c.BROTLI_PARAM_QUALITY]: quality };
    if (r.chance(2, 3)) params[c.BROTLI_PARAM_LGWIN] = r.range(10, 24);
    if (r.chance(1, 4)) params[c.BROTLI_PARAM_MODE] = r.below(3);
    if (r.chance(1, 6)) params[c.BROTLI_PARAM_LGBLOCK] = r.range(16, 24);
    if (r.chance(1, 8)) params[c.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING] = 1;
    if (r.chance(1, 3)) params[c.BROTLI_PARAM_SIZE_HINT] = r.chance(2, 3) ? input.length : r.below(1 << 22);
    if (r.chance(1, 10)) {
      params[c.BROTLI_PARAM_LARGE_WINDOW] = 1;
      params[c.BROTLI_PARAM_LGWIN] = r.range(10, 26);
    }
    if (r.chance(1, 6)) {
      const npostfix = r.below(4);
      params[c.BROTLI_PARAM_NPOSTFIX] = npostfix;
      params[c.BROTLI_PARAM_NDIRECT] = r.below(16) << npostfix;
    }
    const k: EncoderCase = { input, params };
    if (r.chance(1, 6)) {
      k.dictionary =
        input.length > 32 && r.chance(1, 2)
          ? { ...input, from: r.below(input.length >> 1), length: r.range(8, input.length >> 1) }
          : { kind: input.kind, seed: r.next(), length: r.range(1, 20_000) };
    }
    if (r.chance(1, 6)) k.chunkSize = r.pick([64, 100, 1000, 5000, 1 << 17]);
    if (r.chance(1, 4)) {
      k.writes = [];
      for (let left = input.length; left > 0 && k.writes.length < 12;) {
        const size = Math.min(left, r.range(1, Math.max(1, input.length >> 1)));
        k.writes.push([size, r.chance(1, 3) ? r.pick([c.BROTLI_OPERATION_FLUSH, c.BROTLI_OPERATION_PROCESS]) : -1]);
        left -= size;
      }
    }
    cases.push(k);
  }
  return cases;
}

/** Streams that are intact, cut short or damaged. */
export async function generateDecoderCases(count = 600, seed = 2) {
  const r = prng(seed);
  const cases: DecoderCase[] = [];
  while (cases.length < count) {
    const quality = r.below(12);
    const input: Input = {
      kind: r.pick(kinds),
      seed: r.next(),
      length: r.pick([0, 1, 5, 40, 300, 1500, 6000, 40_000]),
    };
    const params: Record<number, number> = {
      [c.BROTLI_PARAM_QUALITY]: quality,
      [c.BROTLI_PARAM_LGWIN]: r.range(10, 24),
    };
    const largeWindow = r.chance(1, 10);
    if (largeWindow) params[c.BROTLI_PARAM_LARGE_WINDOW] = 1;
    const k: EncoderCase = { input, params };
    if (r.chance(1, 8)) k.dictionary = { kind: input.kind, seed: input.seed, length: r.range(1, 3000) };
    const stream = await encode(k);
    if (stream.length > 1500) continue;
    const dictionary = k.dictionary && makeInput(k.dictionary).toString("base64");
    for (let n = 0; n < 6 && cases.length < count; n++) {
      const damaged = Buffer.from(stream);
      let result = damaged;
      if (n > 0 && damaged.length > 0) {
        switch (r.below(6)) {
          case 0:
            result = damaged.subarray(0, r.below(damaged.length));
            break;
          case 1:
            result = Buffer.concat([damaged, Buffer.from([r.next() & 255])]);
            break;
          case 2:
            damaged[r.below(Math.min(damaged.length, 12))] ^= 1 << r.below(8);
            break;
          case 3:
            damaged[r.below(damaged.length)] = r.next();
            break;
          default:
            for (let flips = r.range(1, 3); flips > 0; flips--) damaged[r.below(damaged.length)] ^= 1 << r.below(8);
        }
      }
      const d: DecoderCase = { stream: result.toString("base64") };
      if (largeWindow ? r.chance(9, 10) : r.chance(1, 10)) d.params = { [c.BROTLI_DECODER_PARAM_LARGE_WINDOW]: 1 };
      if (r.chance(1, 10)) d.params = { ...d.params, [c.BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION]: 1 };
      if (dictionary && r.chance(9, 10)) d.dictionary = dictionary;
      if (r.chance(1, 5)) d.chunkSize = r.pick([64, 65, 200, 4096]);
      if (cases.length % 7 === 0) d.pieces = [32, 150, 1000][(cases.length / 7) % 3];
      cases.push(d);
    }
  }
  const stream = zlib.brotliCompressSync(makeInput({ kind: "Text", seed: 3, length: 3000 })).toString("base64");
  for (const params of [
    { [c.BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION]: 2 },
    { [c.BROTLI_DECODER_PARAM_LARGE_WINDOW]: 2 },
    // The decoder has no such parameters.
    { [c.BROTLI_DECODER_PARAM_LARGE_WINDOW + 1]: 0 },
    { [c.BROTLI_PARAM_NDIRECT]: 1 },
  ]) {
    cases.push({ stream, params });
  }
  return cases;
}

export const load = async <T>(path: string): Promise<T[]> =>
  JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(path).bytes())).toString());

/** The cases that came out differently, for the failure message. */
export function differences(results: { index: number; expected?: string; actual: string; what: unknown }[]) {
  return results
    .filter(r => r.expected !== r.actual)
    .slice(0, 10)
    .map(r => `case ${r.index}: expected ${r.expected}, got ${r.actual}: ${JSON.stringify(r.what).slice(0, 300)}`)
    .join("\n");
}
