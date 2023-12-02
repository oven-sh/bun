// original code:
// var re_btou = new RegExp(
//   [
//     "[\xC0-\xDF][\x80-\xBF]",
//     "[\xE0-\xEF][\x80-\xBF]{2}",
//     "[\xF0-\xF7][\x80-\xBF]{3}",
//   ].join("|"),
//   "g"
// );

export var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
export var re_btou = new RegExp(
  ["[\xC0-\xDF][\x80-\xBF]", "[\xE0-\xEF][\x80-\xBF]{2}", "[\xF0-\xF7][\x80-\xBF]{3}"].join("|"),
  "g",
);

const encoder = new TextEncoder();
const realLines = ["[\xC0-\xDF][\x80-\xBF]", "[\xE0-\xEF][\x80-\xBF]{2}", "[\xF0-\xF7][\x80-\xBF]{3}"];
const real = realLines.map(input => Array.from(encoder.encode(input)));

const expected = [
  [91, 195, 128, 45, 195, 159, 93, 91, 194, 128, 45, 194, 191, 93],
  [91, 195, 160, 45, 195, 175, 93, 91, 194, 128, 45, 194, 191, 93, 123, 50, 125],
  [91, 195, 176, 45, 195, 183, 93, 91, 194, 128, 45, 194, 191, 93, 123, 51, 125],
];

const newlinePreserved = `\n`;

export function test() {
  if (!real.every((point, i) => point.every((val, j) => val === expected[i][j]))) {
    throw new Error(
      `test failed
${JSON.stringify({ expected, real }, null, 2)}`,
    );
  }

  if (newlinePreserved.length !== 1 || newlinePreserved.charCodeAt(0) !== 10) {
    throw new Error("Newline was not preserved");
  }

  const decoder = new TextDecoder("utf8");
  if (!realLines.every((line, i) => decoder.decode(Uint8Array.from(expected[i])) === line)) {
    throw new Error(
      `test failed. Lines did not match.
${JSON.stringify({ expected, real }, null, 2)}`,
    );
  }

  testDone(import.meta.url);
}
