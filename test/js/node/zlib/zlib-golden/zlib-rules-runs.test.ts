// The same longest match over and over, for more than a window.
import { expect, test } from "bun:test";
import zlib from "node:zlib";
import { Engine, inflate, piecesOf, Z_FINISH, Z_SYNC_FLUSH } from "./engine";
import { input } from "./inputs";
import { Bits, fixed, inGzip, stored, type Token } from "./write";

const A = 65;
const tooFar = "Z_DATA_ERROR invalid distance too far back";
const LONGEST = 258;
/** A period, so many matches, and then what tells whether the window is still right. */
function run(distance: number, count: number, window: number) {
  const period = input("noise", distance);
  const behind = [A, { length: 40, distance: window }, { length: 9, distance }, { length: LONGEST, distance: 2 }];
  const tokens: Token[] = [...Array(count).fill({ length: LONGEST, distance }), ...behind];
  const start = distance + count * LONGEST;
  const expected = Buffer.concat([Buffer.alloc(start, period)], start + 1 + 40 + 9 + LONGEST);
  let at = start;
  for (const token of behind) {
    if (typeof token === "number") expected[at++] = token;
    else for (const end = at + token.length; at < end; at++) expected[at] = expected[at - token.distance];
  }
  return { data: fixed(stored(new Bits(), period, false), tokens, true).end(), expected };
}

test.each([1, 2, 7, 43, 129, 257, 258, 259, 1000, 16385, 32510, 32767, 32768])("at distance %d", distance => {
  const wrong: unknown[] = [];
  for (const count of [127, 130, 300, 511]) {
    const { data, expected } = run(distance, count, 32768);
    for (const [chunkSize, piece] of [
      [LONGEST, data.length],
      [1000, 333],
      [16384, data.length],
      [33000, 50],
      [1 << 18, data.length],
    ]) {
      const wrapped = inGzip(data, expected);
      const { output, read, error } = inflate("Gunzip", piecesOf(Buffer.concat([wrapped, Buffer.alloc(1)]), piece), {
        chunkSize,
      });
      if (error || read !== wrapped.length || !output.equals(expected)) wrong.push([count, chunkSize, error]);
    }
  }
  expect(wrong).toEqual([]);
});

test("in a window that also has something else", () => {
  const start = input("noise", 32768);
  const tokens = [...Array(20).fill({ length: LONGEST, distance: 3 }), { length: 50, distance: 32768 }];
  const output = zlib.inflateRawSync(fixed(stored(new Bits(), start, false), tokens, true).end(), {
    chunkSize: 1 << 16,
  });
  expect(output.subarray(-50)).toEqual(start.subarray(20 * LONGEST, 20 * LONGEST + 50));
});

test.each([512, 513])("at distance %d with windowBits 9", distance => {
  const { data, expected } = run(distance, 300, 512);
  const inOneGo = inflate("InflateRaw", [data], { windowBits: 9, chunkSize: 1 << 18 });
  expect([inOneGo.error, inOneGo.output.equals(expected)]).toEqual([undefined, true]);
  const { output, error } = inflate("InflateRaw", [data], { windowBits: 9, chunkSize: 50000 });
  expect([error, output.length]).toEqual(distance === 512 ? [undefined, expected.length] : [tooFar, 50000]);
});

test("that is cut short, or interrupted by reset()", () => {
  const { data, expected } = run(7, 400, 32768);
  const cut = zlib.inflateRawSync(data.subarray(0, 500), { finishFlush: Z_SYNC_FLUSH });
  // 12 bytes for the stored block, 3 bits for the header, and 14 bits for each match.
  expect(cut.equals(expected.subarray(0, 7 + LONGEST * Math.floor((488 * 8 - 3) / 14)))).toBe(true);
  using engine = new Engine("InflateRaw");
  engine.writeUntilFull(data, 50000);
  engine.reset();
  const other = run(1000, 200, 32768);
  engine.write(other.data, Z_FINISH);
  expect([engine.error, engine.output.equals(other.expected)]).toEqual([undefined, true]);
});

test.each([1, 7, 31, 32, 300])("stays in the range that it is given, at distance %d", distance => {
  const { data, expected } = run(distance, 300, 32768);
  const wrong: number[] = [];
  for (const room of [383, 384, 385, 700, 20000, expected.length - 1, expected.length, expected.length + 400]) {
    const stream: any = zlib.createInflateRaw();
    const out = Buffer.alloc(64 + room + 64, 0xa5);
    stream._handle.writeSync(Z_SYNC_FLUSH, data, 0, data.length, out, 64, room);
    const written = room - stream._writeState[0];
    stream.close();
    const around = Buffer.concat([out.subarray(0, 64), out.subarray(64 + room)]);
    const isRight = out.subarray(64, 64 + written).equals(expected.subarray(0, room));
    if (!isRight || !around.equals(Buffer.alloc(128, 0xa5))) wrong.push(room);
  }
  expect(wrong).toEqual([]);
});
