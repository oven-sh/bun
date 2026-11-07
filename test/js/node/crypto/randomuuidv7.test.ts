/**
 * crypto.randomUUIDv7() is a millisecond timestamp and 74 random bits. Node
 * reads the timestamp with the primordial DateNow() and keeps no counter and
 * no last timestamp, so two UUIDs from one millisecond have no order:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/random.js#L418-L448
 *
 * Bun used the counter and the last timestamp of Bun.randomUUIDv7() for it.
 * Every such UUID then sorted after the one before it, and its timestamp could
 * be ahead of Date.now().
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason.
 */
import assert from "node:assert";
import { randomUUIDv7 } from "node:crypto";
import { test } from "node:test";

// The first 48 bits.
const timestamp = (uuid: string) => parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
// The 12 bits after the version digit, rand_a in RFC 9562.
const randA = (uuid: string) => parseInt(uuid.slice(15, 18), 16);

for (const options of [undefined, { disableEntropyCache: true }]) {
  test(`randomUUIDv7(${options ? "{ disableEntropyCache: true }" : ""}) has no counter`, () => {
    // 64 pairs of adjacent UUIDs, each pair from one millisecond.
    const pairs: [string, string][] = [];
    for (let i = 0; i < 1_000_000 && pairs.length < 64; i++) {
      const before = Date.now();
      const first = randomUUIDv7(options);
      const second = randomUUIDv7(options);
      const after = Date.now();
      // The check of Node's test-crypto-randomuuidv7.js, on every pair.
      assert.ok(before <= timestamp(first), `${first} is before ${before}`);
      assert.ok(timestamp(second) <= after, `${second} is after ${after}`);
      if (timestamp(first) === timestamp(second)) pairs.push([first, second]);
    }
    assert.strictEqual(pairs.length, 64);

    // A counter puts every pair in call order. Random bits do that for 64
    // pairs with a probability of 2^-64.
    assert.ok(
      pairs.some(([first, second]) => second < first),
      "every pair is in call order",
    );
    // A counter that starts each millisecond below 0x800 leaves this bit clear.
    assert.ok(
      pairs.some(([first]) => (randA(first) & 0x800) !== 0),
      "the top bit of rand_a is never set",
    );
  });
}
