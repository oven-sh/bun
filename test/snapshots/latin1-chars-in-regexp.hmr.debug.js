import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(true);
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
var hmr = new FastHMR(3390984578, "latin1-chars-in-regexp.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
  var re_btou = new RegExp([
    "[\xC0-\xDF][\x80-\xBF]",
    "[\xE0-\xEF][\x80-\xBF]{2}",
    "[\xF0-\xF7][\x80-\xBF]{3}"
  ].join("|"), "g");
  const encoder = new TextEncoder;
  const realLines = [
    "[\xC0-\xDF][\x80-\xBF]",
    "[\xE0-\xEF][\x80-\xBF]{2}",
    "[\xF0-\xF7][\x80-\xBF]{3}"
  ];
  const real = realLines.map((input) => Array.from(encoder.encode(input)));
  const expected = [
    [91, 195, 128, 45, 195, 159, 93, 91, 194, 128, 45, 194, 191, 93],
    [
      91,
      195,
      160,
      45,
      195,
      175,
      93,
      91,
      194,
      128,
      45,
      194,
      191,
      93,
      123,
      50,
      125
    ],
    [
      91,
      195,
      176,
      45,
      195,
      183,
      93,
      91,
      194,
      128,
      45,
      194,
      191,
      93,
      123,
      51,
      125
    ]
  ];
  const newlinePreserved = `\n`;
  function test() {
    if (!real.every((point, i) => point.every((val, j) => val === expected[i][j])))
      throw new Error(`test failed
${JSON.stringify({ expected, real }, null, 2)}`);
    if (newlinePreserved.length !== 1 || newlinePreserved.charCodeAt(0) !== 10)
      throw new Error("Newline was not preserved");
    const decoder = new TextDecoder("utf8");
    if (!realLines.every((line, i) => decoder.decode(Uint8Array.from(expected[i])) === line))
      throw new Error(`test failed. Lines did not match.
${JSON.stringify({ expected, real }, null, 2)}`);
    testDone(import.meta.url);
  }
  hmr.exportAll({
    re_utob: () => re_utob,
    re_btou: () => re_btou,
    test: () => test
  });
})();
var $$hmr_re_utob = hmr.exports.re_utob, $$hmr_re_btou = hmr.exports.re_btou, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_re_utob = exports.re_utob;
  $$hmr_re_btou = exports.re_btou;
  $$hmr_test = exports.test;
};

export {
  $$hmr_re_utob as re_utob,
  $$hmr_re_btou as re_btou,
  $$hmr_test as test
};

//# sourceMappingURL=http://localhost:8080/latin1-chars-in-regexp.js.map
