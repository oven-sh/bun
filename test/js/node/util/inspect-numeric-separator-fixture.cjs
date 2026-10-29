// The rows for the numbers that util.inspect and util.format print with numericSeparator, through each caller of the
// number formatter. util.test.js runs them in Bun. Run as the main module, this file prints what the runtime prints
// for each row, so that Node.js runs the same rows.
const util = require("node:util");

const separator = { numericSeparator: true };

function withDefaultSeparator(print) {
  const { numericSeparator } = util.inspect.defaultOptions;
  util.inspect.defaultOptions.numericSeparator = true;
  try {
    return print();
  } finally {
    util.inspect.defaultOptions.numericSeparator = numericSeparator;
  }
}

const getter = {
  get a() {
    return -0.1234;
  },
};

// Each row: a label, a function that prints, and the text that Node.js v26.12.1 prints.
// prettier-ignore
const rows = [
  ["%d %i %f %s of -0", () => util.formatWithOptions(separator, "%d %i %f %s", -0, -0, -0, -0), "-0 0 0 -0"],
  ["%d %f %s %o of 1.5e-7", () => util.formatWithOptions(separator, "%d %f %s %o", 1.5e-7, 1.5e-7, 1.5e-7, 1.5e-7), "1.5e-7 1.5e-7 1.5e-7 1.5e-7"],
  ["%d %f %s %O of -0.1234", () => util.formatWithOptions(separator, "%d %f %s %O", -0.1234, -0.1234, -0.1234, [-0.1234]), "-0.123_4 -0.123_4 -0.123_4 [ -0.123_4 ]"],
  ["the elements of a Float64Array", () => util.inspect(new Float64Array([-0, 1.5e-7, -0.5, 100000.5]), separator), "Float64Array(4) [ -0, 1.5e-7, -0.5, 100_000.5 ]"],
  ["Number objects", () => util.inspect([new Number(-0), new Number(1e-7), new Number(-0.1234)], separator), "[ [Number: -0], [Number: 1e-7], [Number: -0.123_4] ]"],
  ["a key and a value of a Map", () => util.inspect(new Map([[-0.1234, 1e-7]]), separator), "Map(1) { -0.123_4 => 1e-7 }"],
  ["the value of a getter", () => util.inspect(getter, { getters: true, numericSeparator: true }), "{ a: [Getter: -0.123_4] }"],
  ["util.inspect with inspect.defaultOptions", () => withDefaultSeparator(() => util.inspect([-0, -0.25, 1.5e-7])), "[ -0, -0.25, 1.5e-7 ]"],
  ["util.format with inspect.defaultOptions", () => withDefaultSeparator(() => util.format("%d %d", -0.25, 1.5e-7)), "-0.25 1.5e-7"],
];

module.exports = rows;

if (require.main === module) console.log(JSON.stringify(rows.map(([label, print]) => [label, print()])));
