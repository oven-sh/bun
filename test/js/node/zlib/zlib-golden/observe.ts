// What node:zlib makes of an input, as text, and how that differs from what was recorded.
import { isASAN, isDebug } from "harness";
import { join } from "node:path";
import { differences } from "../../../bun/archive-golden/observe";
import { Engine, inflate, nothing, piecesOf, Z_FINISH, Z_NO_FLUSH, type Mode } from "./engine";
import { input, random, type Kind } from "./inputs";
import { inGzip, inZlib, randomStream } from "./write";

/** About one in so many, at no regular interval, as the cases are in an order that has periods. */
export const sample = <T>(all: T[], oneIn: number) =>
  all.filter((_, i) => (Math.imul(i, 0x9e3779b1) >>> 0) / 2 ** 32 < 1 / oneIn);

/** These builds run JavaScript many times slower, so they get a part of what the others get. */
export const fewerIfSlow = <T>(all: T[], oneIn: number) => (isDebug || isASAN ? sample(all, oneIn) : all);

/** The arguments of `input()`. */
type Source = [Kind, number, number];

export type DeflateCase = {
  mode: "Deflate" | "DeflateRaw" | "Gzip";
  /** level, strategy, windowBits, memLevel, chunkSize */
  options: [number, number, number, number, number];
  source: Source;
  dictionary?: Source;
  /**
   * Separated by spaces: `12` writes so many bytes, `12:2` does so with that flush value, `p9,1` changes the level and
   * the strategy, `r` starts another stream. What is left of the source goes with Z_FINISH. Unlike a stream, `12!` does
   * not drain the output and `P9,1` does not flush.
   */
  steps: string;
  result: string;
};

export type DamagedCase = {
  /** The arguments of `randomStream()`. */
  stream: [seed: number, size: number, windowBits: number];
  /** For each way to damage it. */
  results: string[];
};

export type Cases = { whole: DeflateCase[]; steps: DeflateCase[]; rare: DeflateCase[]; damaged: DamagedCase[] };

export const fixture = join(import.meta.dir, "cases.json.gz");
export const library = "libdeflate";

export async function loadCases(): Promise<Cases> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(fixture).bytes(), { library })).toString());
}

/** For `test.each()`. */
export function inParts<T>(cases: T[], size: number) {
  return Array.from({ length: Math.ceil(cases.length / size) }, (_, i) => [cases.slice(size * i, size * (i + 1))]);
}

const hash = (bytes: Uint8Array | string) => Bun.hash.xxHash32(bytes).toString(36);

export function optionsOf({ options: [level, strategy, windowBits, memLevel, chunkSize], dictionary }: DeflateCase) {
  return { level, strategy, windowBits, memLevel, chunkSize, dictionary: dictionary && input(...dictionary) };
}

const GZIP_OS = 9;
const inverse = { Deflate: "Inflate", DeflateRaw: "InflateRaw", Gzip: "Gunzip" } as const;

export function deflate(c: DeflateCase) {
  using engine = new Engine(c.mode, optionsOf(c));
  const source = input(...c.source);
  /** How much output there was after each step. */
  const lengths: number[] = [];
  /** Where each is in the source and in the output. */
  const streams = [{ read: 0, written: 0, isFinished: false }];
  function write(length: number, flush: number, drains?: boolean) {
    engine.write(source.subarray(engine.read, engine.read + length), flush, drains);
    streams.at(-1)!.isFinished = flush === Z_FINISH;
  }
  for (const step of c.steps.split(" ").filter(Boolean)) {
    if (step === "r") {
      engine.reset();
      streams.push({ read: engine.read, written: engine.written, isFinished: false });
    } else if (step[0] === "p" || step[0] === "P") {
      const [level, strategy] = step.slice(1).split(",").map(Number);
      engine.params(level, strategy, step[0] === "p");
    } else if (step.endsWith("!")) {
      write(parseInt(step), Z_NO_FLUSH, false);
    } else {
      const [length, flush = Z_NO_FLUSH] = step.split(":").map(Number);
      write(length, flush);
    }
    lengths.push(engine.written);
  }
  write(source.length, Z_FINISH);
  return { source, lengths, streams, output: engine.output, error: engine.error };
}

export const WRONG = "wrong:";

export function observeDeflate(c: DeflateCase) {
  const { source, lengths, streams, output, error } = deflate(c);
  const options = optionsOf(c);
  // What is asked to be 8 is 9.
  options.windowBits = Math.max(options.windowBits, 9);
  let wrong = error;
  streams.forEach(({ read, written, isFinished }, i) => {
    const stream = output.subarray(written, streams[i + 1]?.written);
    if (isFinished) {
      const back = inflate(inverse[c.mode], [stream], options);
      const isSame = back.output.equals(source.subarray(read, streams[i + 1]?.read));
      wrong ??= back.error ?? (isSame ? undefined : "other bytes");
    }
    if (c.mode === "Gzip") stream[GZIP_OS] = 0;
  });
  return `${output.length} ${hash(output)} after ${hash(lengths.join())}${wrong ? ` ${WRONG} ${wrong}` : ""}\n`;
}

export const nameOf = ({ result, ...c }: DeflateCase) => JSON.stringify(c);

export function deflateDifferences(cases: DeflateCase[]) {
  return differences(cases.map(c => ({ index: nameOf(c), expected: c.result, actual: observeDeflate(c) })));
}

export const DAMAGES = 24;

export function observeDamaged({ stream: [seed, size, windowBits] }: DamagedCase) {
  const { raw, plain } = randomStream(seed, size, 1 << windowBits);
  const next = random(~seed);
  const fields = { extra: Buffer.from("ab"), name: "c", comment: "d", headerCrc: true };
  const wrapped: [Mode, Buffer][] = [
    ["InflateRaw", raw],
    ["Inflate", inZlib(raw, plain, windowBits)],
    ["Gunzip", inGzip(raw, plain, fields)],
    ["Unzip", seed & 1 ? inZlib(raw, plain, windowBits) : inGzip(raw, plain)],
  ];
  return Array.from({ length: DAMAGES }, (_, i) => {
    const [mode, whole] = wrapped[i % wrapped.length];
    let data = Buffer.from(whole);
    const anywhere = () => next(next(2) ? data.length : Math.min(data.length, 48));
    const how = next(6);
    if (how === 0) data = data.subarray(0, anywhere());
    else if (how === 1) data[anywhere()] = next(256);
    else if (how === 2) data.copyWithin(anywhere(), anywhere());
    else if (how === 3) data[data.length - 1 - next(Math.min(data.length, 10))] ^= 1 << next(8);
    else data[anywhere()] ^= 1 << next(8);
    const chunkSize = [64, 65, 259, 260, 300, 1000, 16384][next(7)];
    const largest = [1, 7, 20, 200, 1 << 20][next(data.length < 400 ? 5 : 3) + (data.length < 400 ? 0 : 2)];
    // At times the window is smaller than the stream was written for.
    const options = { chunkSize, windowBits: next(4) ? windowBits : 8 + next(8) };
    const pieces = [...piecesOf(data, () => 1 + next(largest)), ...(next(2) ? [nothing] : [])];
    const { output, read, error } = inflate(mode, pieces, options);
    return `${read} to ${output.length} ${hash(output)}${error ? ` ${error}` : ""}\n`;
  });
}

export function damagedDifferences(cases: DamagedCase[]) {
  const results = cases.flatMap(c =>
    observeDamaged(c).map((actual, i) => ({ index: `${c.stream} damage ${i}`, expected: c.results[i], actual })),
  );
  return differences(results);
}
