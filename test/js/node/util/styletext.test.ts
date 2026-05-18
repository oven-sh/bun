/**
 * Runs under `bun test` and (via node:test/node:assert) under
 * `node --experimental-strip-types --test`. Green under Node proves the
 * assertions encode real Node v22 behaviour, so a green run under Bun means
 * Bun matches Node.
 *
 * Node v22 made `util.styleText` colour-aware and option-validating. Bun's
 * port took only `(format, text)`: it always emitted ANSI (corrupting piped /
 * redirected logs, ignoring `NO_COLOR`), silently ignored `stream` /
 * `validateStream`, and wrongly threw on the valid `'none'` format.
 */
import assert from "node:assert";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { styleText } from "node:util";

test("styleText does not colourize a non-TTY stream", () => {
  assert.strictEqual(styleText("red", "x", { stream: new PassThrough() }), "x");
  assert.strictEqual(styleText(["bold", "red"], "x", { stream: new PassThrough() }), "x");
});

test("styleText with validateStream:false always colourizes", () => {
  assert.strictEqual(styleText("red", "x", { validateStream: false }), "\u001b[31mx\u001b[39m");
  assert.strictEqual(
    styleText(["bold", "red"], "test", { validateStream: false }),
    "\u001b[1m\u001b[31mtest\u001b[39m\u001b[22m",
  );
});

test("styleText skips the 'none' format instead of throwing", () => {
  assert.strictEqual(styleText(["red", "none"], "x", { validateStream: false }), "\u001b[31mx\u001b[39m");
  assert.strictEqual(styleText("none", "x", { validateStream: false }), "x");
  assert.strictEqual(styleText(["red", "none"], "x", { stream: new PassThrough() }), "x");
});

test("styleText reapplies the style after a nested reset", () => {
  assert.strictEqual(
    styleText("red", "a\u001b[39mb", { validateStream: false }),
    "\u001b[31ma\u001b[31mb\u001b[39m",
  );
});

test("styleText validates options.validateStream", () => {
  assert.throws(() => styleText("red", "x", { validateStream: "x" }), { code: "ERR_INVALID_ARG_TYPE" });
});

test("styleText validates the stream option", () => {
  for (const stream of [123, {}, "nope", Symbol()]) {
    assert.throws(() => styleText("red", "x", { stream }), { code: "ERR_INVALID_ARG_TYPE" });
  }
});

test("styleText still validates format and text", () => {
  assert.throws(() => styleText("invalid", "x", { validateStream: false }), { code: "ERR_INVALID_ARG_VALUE" });
  assert.throws(() => styleText("red", 123, { validateStream: false }), { code: "ERR_INVALID_ARG_TYPE" });
});
