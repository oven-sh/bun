// From coefficients to samples, to the last bit. model.ts says what has to come out, and it shares no code with Bun.
import { describe, expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { expectPictures, range, said, withMoreBehind } from "./decode";
import { blockSize, natural, pictureOf, sizes, transforms, type Colors } from "./model";
import { frameOf, write } from "./write";

describe.each(sizes)("blocks of %i samples each way", size => {
  // The large ones are for components with half as many blocks, which in RGB are seen as they are.
  const [sampling, eighths, colors]: [string, number, Colors] =
    size > 8 ? ["2x2,1x1,1x1", size / 2, "RGB"] : ["1x1", size, "gray"];
  /** So many blocks for `fill` to fill, in rows of 16. */
  function expectBlocks(count: number, fill: (block: Int32Array, i: number) => void, steps = Array(64).fill(1)) {
    const mcu = size > 8 ? 16 : 8;
    const parts = size > 8 ? 2 : 1;
    const frame = frameOf(16 * mcu, Math.ceil(count / parts / 16) * mcu, sampling, { tables: [steps] });
    const shown = frame.components.slice(-parts);
    expect(blockSize(frame, shown[0], eighths)).toBe(size);
    for (let i = 0; i < count; i++) fill(shown[i % parts].data.subarray(Math.floor(i / parts) * 64).subarray(0, 64), i);
    const file = write(frame, undefined, { before: said[colors] });
    const expected = pictureOf(frame, { eighths, colors });
    return expectPictures([file, withMoreBehind(file)].map(file => ({ name: `${size}`, file, eighths, expected })));
  }
  const random = randomBytes(size);
  const within = (limit: number) => (((random() << 8) | random()) % (2 * limit + 1)) - limit;

  test("each coefficient by itself", async () => {
    const values = [1, -1, 37, -200, 500, -1023];
    await expectBlocks(64 * values.length, (block, i) => (block[i % 64] = values[i >> 6]));
  });

  test("all at once", async () => {
    await expectBlocks(slow ? 64 : 256, block => block.forEach((_, k) => (block[k] = within(k ? 100 : 200))));
  });

  test("some rows and columns", async () => {
    // By the bits of the number of the block.
    await expectBlocks(512, (block, i) =>
      block.forEach((_, k) => {
        const line = i & 256 ? natural[k] >> 3 : natural[k] & 7;
        if ((i >> line) & 1) block[k] = within(60);
      }),
    );
  });

  test("the first few of the zigzag, with a table", async () => {
    const steps = range(0, 63).map(k => 1 + ((k * 37) % 50));
    await expectBlocks(
      128,
      (block, i) => block.forEach((_, k) => k <= i % 64 && (block[k] = within(Math.ceil(50 / steps[k])) || 1)),
      steps,
    );
  });

  test("samples are held to 0 to 255", async () => {
    const levels = [-512, -400, -257, -256, -130, -129, -128, -127, 126, 127, 128, 129, 255, 256, 400, 511];
    await expectBlocks(
      48,
      (block, i) => {
        block[0] = levels[i % 16];
        if (i >= 16 && Math.abs(block[0]) < 500) block[i >> 4] = 20;
      },
      Array(64).fill(8),
    );
  });

  test("what is too large for any sample is the same on every CPU", async () => {
    const steps = range(0, 63).map(k => [40000, 1, 255, 3, 65535, 16, 32768, 7][k % 8]);
    for (const table of [Array(64).fill(1), steps, steps.toReversed()]) {
      // From a few to all of them, of up to 7 to 14 bits.
      await expectBlocks(
        slow ? 64 : 256,
        (block, i) => block.forEach((_, k) => random() >> 2 <= i % 64 && (block[k] = within((128 << (i % 8)) - 1))),
        table,
      );
    }
  });

  test("so it is with nothing but a DC coefficient", async () => {
    const values = [1, 3, 4, 5, 1019, 1020, 1027, 1028, 1029, 7163, 7164, 8191, 8192, 9220, 16384, 31739, 31740, 32767];
    for (const step of slow ? [1, 255, 40000, 65535] : [1, 3, 255, 32767, 32768, 40000, 65535]) {
      // With 0 in between, also where two components take turns.
      await expectBlocks(
        values.length * 8,
        (block, i) => (block[0] = i & 2 ? 0 : (i & 4 ? -1 : 1) * values[i >> 3]),
        Array(64).fill(step),
      );
    }
  });

  test("and with nothing beyond the first rows and columns", async () => {
    // From 1 to 8 of each, with up to 7 to 14 bits.
    await expectBlocks(slow ? 128 : 512, (block, i) =>
      block.forEach((_, k) => {
        if (natural[k] >> 3 <= i % 8 && natural[k] % 8 <= (i >> 3) % 8) block[k] = within((128 << (random() & 7)) - 1);
      }),
    );
  });

  // With one AC coefficient in the first row or column, a sample is the sum of two products, rounded. These sums are
  // so little above being rounded down that a factor of one more, or of one less, would do it.
  test.skipIf(size === 1)("the last bit of every factor", async () => {
    const { factors, shift } = transforms[size];
    const cases = range(0, size * 8 - 1).filter(at => at % 8);
    await expectBlocks(cases.length * 4, (block, i) => {
      const [at, sign, inRow] = [cases[i >> 2], i & 1 ? 1 : -1, i & 2];
      const product = (value: number) => factors[at] * sign * value + (inRow ? 0 : 1 << (shift - 3));
      let value = 1400;
      while (value > 1 && (product(value) & ((1 << shift) - 1)) >= value) value--;
      block[natural.indexOf(inRow ? at % 8 : (at % 8) * 8)] = sign * value;
      block[0] = 4 - (product(value) >> shift);
    });
  });
});
