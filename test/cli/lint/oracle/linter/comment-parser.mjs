// `ConfigCommentParser` of @eslint/plugin-kit against `src/lint/linter/comment.rs`.

import { random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { ConfigCommentParser } = requireFromEslint("@eslint/plugin-kit");
const parser = new ConfigCommentParser();

const seeds = {
  parseDirective: [
    "eslint-disable", " eslint-disable foo, bar -- why not", "eslint-disable-next-line foo -- a -- b", "eslint-enable",
    "eslint eqeqeq: 2", "global a, b:writable", "globals a", "exported a, b", "eslint-disable-line foo --", "eslint-disable --x",
    "eslint-disable -- ", "eslint-disable ---- x", "eslint-disable\n--\nx", "eslint-disable\u00a0--\u2028x", "eslint-disablefoo",
    "eslint-", "eslint--disable", "Eslint-disable", "eslint-disable2", "*eslint-disable", "", " ", "a-b-c d", "-- eslint-disable",
    "eslint-disable foo--bar", "eslint-disable foo -- bar--baz -- qux", "\ufeffeslint-disable\ufeff", "eslint-disable - - x",
  ],
  parseListConfig: [
    "a, b, c", "a", "", ",", "a,,b", " a , b ", "'a', \"b\"", "'a\", b", "'", "''", "'a', 'a', a", "a b, c", "a\n,\nb",
    "@scope/a/b, c/d", "'a, b'", "\u00a0a\u00a0,\u2003b", "\"a\nb\"",
  ],
  parseStringConfig: [
    "a, b", "a:true, b:false", "a: true", "a :true", "a : true , b", "a b c", "a:b:c", "a:", ":b", ":", ",", "a,,b", "a , : b",
    "a: , b", "a\n:\nwritable\nb", "a:off,b:readonly c:writable", "", " ", "a\u00a0b", "a \u2003: b", "a,b:c d:e,f", "a::b", "a: :b",
    "é:writable 😀", "a:b a:c a",
  ],
  parseJSONLikeConfig: [
    "no-alert: 2", "no-alert: 2, semi: [2, always]", "no-alert:2 semi:[2,'always']", "no-alert: 2 no-console: 2",
    "quotes: [2, \"double\"], semi: 0", "\"quotes\": [\"error\", \"double\", {\"avoidEscape\": true}]", "a: off, b: warn, c: error",
    "a: [error, {b: c, d: [1, 2, {e: f}]}]", "a: 3", "a: foo", "a: [foo]", "a: []", "a:", "a", "", " ", "{a: 2}", "{a: 2", "a: 2}",
    "a: 2,", "a: 2,,", ",a: 2", "a: (2, b)", "a: [2, (b, c)]", "a: [2, true, false, null, undefined, NaN, 1.5, -1, 0x10, 1e3, '', \"\"]",
    "a: [2, 'it\\'s', \"say \\\"hi\\\"\", 'a\\nb', 'a\\u0041', 'a\\x', 'a\\\\b']", "a: [2, /re/g, /re/x, #2020-01-01#, #x#, ##]",
    "a: [2, b c, d  e]", "a: [2, \"b\" c]", "a: [2, b: c]", "a: [2, {b}]", "a: [2, {\"b c\": d}]", "'a': 2", "\"a\": 2, 'b/c': 1",
    "@scope/a: 2", "@scope/plugin/a: [2]", "a/b: 2", "a: 2 b: 1 c: 0", "a: [2] b: 1", "a: [2]\n\"b\": 1\n\"c\": 2", "a: \"2\"", "a: '2'",
    "a: 2.0", "a: -0", "a: 02", "a: +2", "a: Infinity", "a: [2, Infinity]", "a: 2, a: 1", "a:2,\"a\":1", "a: {b: 2}", "a: [[2]]",
    "a: 1 2", "a: error b", "a: [error", "a: error]", "a: 'error", "a: \"error", "a: [2, 'x]", "a: [2, \"x\\\"]", "a: [2, 'x\\']",
    "a: [2, /x]", "a: [2, #x]", "a: [2, a#b#c]", "a: [2, http://x.y/z]", "a: [2, {a: 1, a: 2}]", "é: 2", "a: [2, é😀]", "a : 2", "a\n:\n2",
    "a:\u00a02", "a: [2,\u2028b]", "max-len: [2, 100, 2, {ignoreUrls: true, ignorePattern: \"^\\\\s*var\\\\s.+=\\\\s*require\\\\s*\\\\(\"}]",
    "no-restricted-syntax: [error, \"CallExpression[callee.name='foo']\", {selector: 'a > b', message: \"no: really\"}]",
    "a: [2, {b: {c: {d: {e: [[[[1]]]]}}}}]", "a: 2 -- x", "__proto__: 2", "a: [2, {__proto__: 1}]", "1: 2, 0: 2, a: 2",
  ],
};
const alphabet = [..."{}[]():,'\"\\/# \n-aAb2019.-+eé😀_@*", "--", " -- ", "\u00a0", "\u2028", "\\'", "\\\"", "off", "error", "true", "null", "\\u0041", ": ", ", "];

const rng = random(2);
const cases = [];
for (const [method, texts] of Object.entries(seeds)) {
  for (const text of texts) cases.push({ method, text });
  for (let i = 0; i < 25000; i++) {
    const units = [...rng.pick(texts)];
    for (let n = 1 + rng.int(3); n > 0; n--) {
      const at = rng.int(units.length + 1);
      switch (rng.int(3)) {
        case 0: units.splice(at, 1); break;
        case 1: units.splice(at, 0, rng.pick(alphabet)); break;
        default: units.splice(at, 1, rng.pick(alphabet));
      }
    }
    cases.push({ method, text: units.join("") });
  }
}

/** What JSON cannot express is left out of the comparison. */
const isJson = value =>
  value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))
  || (Array.isArray(value) && value.every(isJson))
  || (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isJson));
/** Keys that are array indices come first in a JavaScript object. */
const hasIndexKey = value => typeof value === "object" && value !== null
  && ((!Array.isArray(value) && Object.keys(value).some(key => /^\d+$/.test(key) || key === "__proto__")) || Object.values(value).some(hasIndexKey));

const kept = [], expected = [];
for (const { method, text } of cases) {
  let result = parser[method](text);
  switch (method) {
    case "parseDirective":
      result = result ? { label: result.label, value: result.value, justification: result.justification } : null;
      break;
    case "parseListConfig":
      if (hasIndexKey(result)) continue;
      result = Object.keys(result);
      break;
    case "parseStringConfig":
      if (hasIndexKey(result)) continue;
      result = Object.entries(result);
      break;
    default:
      if (result.ok && (!isJson(result.config) || hasIndexKey(result.config) || /__proto__/.test(text))) continue;
      result = result.ok ? { ok: true, config: result.config } : { ok: false, message: result.error.message.toWellFormed() };
  }
  kept.push({ method, text });
  expected.push(result);
}
// The order of the keys matters.
const ordered = value => JSON.stringify(value);
report("ConfigCommentParser", kept, expected.map(ordered), runBunLint("comment-parser", kept).map(ordered));
