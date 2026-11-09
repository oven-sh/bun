/**
 * querystring.parse() sends a key or a value to the decoder only when that
 * part holds a `%XX` escape. The loop counted the second escape of a KEY as an
 * escape of the VALUE, so a value with no escape was decoded too. When that
 * value also held a "%" that starts no escape, decodeURIComponent() threw and
 * the fallback, unescapeBuffer(), kept one byte of each UTF-16 code unit:
 * U+4F60 came back as 0x60 and U+00E9 as U+FFFD. Node fixed the same loop in
 * https://github.com/nodejs/node/pull/66553 (v26.12.0).
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test` (v26.12.0 or later), which is where the expected values come
 * from.
 */
import assert from "node:assert";
import qs from "node:querystring";
import { describe, test } from "node:test";

const NI = "\u4f60"; // 你
const E_ACUTE = "\u00e9"; // é

type Parsed = Record<string, string | string[] | undefined>;

// Each form takes an input that is written with "&" and "=".
const forms: [string, (input: string) => Parsed][] = [
  ["parse(input)", input => qs.parse(input)],
  // @ts-expect-error @types/node does not admit null, Node's own test passes it
  ["parse(input, null, null)", input => qs.parse(input, null, null)],
  ["parse(input, '&', '=', { maxKeys: 0 })", input => qs.parse(input, "&", "=", { maxKeys: 0 })],
  ["parse(input, ';', ':')", input => qs.parse(input.replaceAll("&", ";").replaceAll("=", ":"), ";", ":")],
  ["parse(input, '&&', '==')", input => qs.parse(input.replaceAll("&", "&&").replaceAll("=", "=="), "&&", "==")],
];

const valueWithoutEscape: [string, Parsed][] = [
  ["%41%42=50%" + NI, { AB: "50%" + NI }],
  ["%41%42=50%" + E_ACUTE, { AB: "50%" + E_ACUTE }],
  ["%E5%90%8D=50% " + NI, { "\u540d": "50% " + NI }],
  ["%C3%A4=caf" + E_ACUTE + "%", { "\u00e4": "caf" + E_ACUTE + "%" }],
  ["%41+%42=+" + NI + "%", { "A B": " " + NI + "%" }],
  ["a=%41&%41%42=" + NI + "%", { a: "A", AB: NI + "%" }],
  ["%41%42&%41%42=" + NI + "%", { AB: ["", NI + "%"] }],
];

const stillDecoded: [string, Parsed][] = [
  ["%41B=50%" + NI, { AB: "50%" + NI }],
  ["%41%42=50" + NI, { AB: "50" + NI }],
  ["AB=50%" + NI, { AB: "50%" + NI }],
  ["%41%42=1&c=50%" + NI, { AB: "1", c: "50%" + NI }],
  ["%41%42=%43" + NI, { AB: "C" + NI }],
  ["%41%42=%E4%BD%A0", { AB: NI }],
  ["%41%42", { AB: "" }],
];

for (const [form, parse] of forms) {
  describe(`querystring.${form}`, () => {
    for (const [input, expected] of valueWithoutEscape) {
      test(`escapes in the key of ${JSON.stringify(input)} do not mark the value as encoded`, () => {
        assert.deepStrictEqual({ ...parse(input) }, expected);
      });
    }

    for (const [input, expected] of stillDecoded) {
      test(`each escape of ${JSON.stringify(input)} is decoded`, () => {
        assert.deepStrictEqual({ ...parse(input) }, expected);
      });
    }
  });
}

describe("querystring.parse", () => {
  test("a partial match of a multi-character eq in the key does not mark the value as encoded", () => {
    assert.deepStrictEqual({ ...qs.parse("%41%4=1==50%" + NI, "&", "==") }, { "A%4=1": "50%" + NI });
    assert.deepStrictEqual({ ...qs.parse("%41%=41==50%" + NI, "&", "==") }, { "A%=41": "50%" + NI });
  });

  test("a value that holds no escape comes back as written for every key", () => {
    const keyParts = ["%41", "%E5%90%8D", "%4", "%", "k", "+", "%zz"];
    const values = ["50%" + NI, "%" + E_ACUTE, NI + "%", "%4" + NI, "%zz" + NI, "100% " + E_ACUTE + " %"];
    const changed: string[] = [];
    for (const a of keyParts) {
      for (const b of keyParts) {
        for (const c of keyParts) {
          for (const value of values) {
            const input = a + b + c + "=" + value;
            const parsed = Object.values(qs.parse(input));
            if (parsed.length !== 1 || parsed[0] !== value) changed.push(input);
          }
        }
      }
    }
    assert.deepStrictEqual(changed, []);
  });
});
