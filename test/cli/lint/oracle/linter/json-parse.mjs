// `JSON.parse` of V8, values and error messages, against `src/lint/linter/json_v8.rs`.

import { random, report, runBunLint } from "./shared.mjs";

const seeds = [
  `{"a":1,"b":[true,false,null],"c":{"d":"e\\n\\u0041"},"f":-1.5e+10}`,
  `{"no-alert":2,"semi":[2,"always"],"quotes":["error","double",{"avoidEscape":true}]}`,
  `[1,2,3]`,
  `"text"`,
  `{"a": 0.5, "b": 1E5, "c": -0}`,
  `{\n  "a": [\n    1,\r\n    2\r  ]\n}`,
  `{"é":"😀 text","long key with spaces":"value that is quite long, more than twenty characters"}`,
  `{}`,
  `  [ ]  `,
  `tru`, `nul`, `fals`, `truex`, `tr1`, `tr"`, `-`, `-a`, `1.`, `1.e`, `1e`, `1e+`, `01`, `0x1`, `.5`, `+1`,
  `"abc`, `"a\\`, `"a\\x"`, `"a\\u12"`, `"a\\u12G4"`, `"a\tb"`, `"a\nb"`, `{`, `{"a"`, `{"a":`, `{"a":1`, `{"a":1,`,
  `{"a":1,}`, `{,}`, `{a:1}`, `{'a':1}`, `[`, `[1`, `[1,`, `[1,]`, `[,]`, `[1 2]`, `{"a":1 "b":2}`, `{"a" 1}`, `1 2`,
  `{} x`, `NaN`, `Infinity`, `undefined`, `[object Object]`, ``, ` `, ` `, `{"a":1} `, `😀`,
  `{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": x}`, `x{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": 1}`, `{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": 1}x`,
  `{"aaaaaaaaaa": 😀😀😀😀😀😀😀😀😀😀😀😀}`, `12345678901234567890x`, `123456789012345678901x`, `1234567890x1234567890`,
];
const alphabet = [..."{}[]:,\"\\ \n\r\ttrufalsn0123456789.-+eExé😀/'u", "\\u", "\\\"", "null", "true", "false", " "];

const rng = random(1);
const cases = [...seeds];
for (let i = 0; i < 60000; i++) {
  let units = [...rng.pick(seeds)];
  for (let n = 1 + rng.int(3); n > 0; n--) {
    const at = rng.int(units.length + 1);
    switch (rng.int(3)) {
      case 0: units.splice(at, 1); break;
      case 1: units.splice(at, 0, rng.pick(alphabet)); break;
      default: units.splice(at, 1, rng.pick(alphabet));
    }
  }
  cases.push(units.join("").toWellFormed());
}

// `-0` and lone surrogates do not survive the way back.
const normalize = value => JSON.parse(JSON.stringify(value).toWellFormed());
const expected = cases.map(text => {
  try {
    return { value: normalize(JSON.parse(text)) };
  } catch (error) {
    return { error: error.message.toWellFormed() };
  }
});
report("JSON.parse", cases, expected, runBunLint("json-parse", cases));
