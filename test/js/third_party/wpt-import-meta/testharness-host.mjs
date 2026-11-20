// The part of WPT's testharness.js that the vendored import.meta files call, for a file that runs as the entry module
// of its own process. wpt-import-meta.test.ts preloads this file and reads the results from stdout.

const results = [];

globalThis.location = { href: process.env.WPT_LOCATION };

globalThis.test = (body, name) => {
  try {
    body();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", message: String(error?.message ?? error) });
  }
};

function format(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return `function ${value.name}`;
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return String(value);
}

function fail(message, description) {
  throw new Error(description ? `${description}: ${message}` : message);
}

// testharness.js compares with SameValue, after the types.
globalThis.assert_equals = (actual, expected, description) => {
  if (typeof actual !== typeof expected || !Object.is(actual, expected))
    fail(`assert_equals: expected ${format(expected)} but got ${format(actual)}`, description);
};

globalThis.assert_not_equals = (actual, expected, description) => {
  if (Object.is(actual, expected)) fail(`assert_not_equals: got disallowed value ${format(actual)}`, description);
};

globalThis.assert_true = (actual, description) => {
  if (actual !== true) fail(`assert_true: expected true got ${format(actual)}`, description);
};

globalThis.assert_false = (actual, description) => {
  if (actual !== false) fail(`assert_false: expected false got ${format(actual)}`, description);
};

// testharness.js wants the error to be made by exactly this constructor: a subclass does not pass.
globalThis.assert_throws_js = (constructor, func, description) => {
  let thrown;
  try {
    func();
  } catch (error) {
    thrown = { error };
  }
  if (!thrown) fail(`assert_throws_js: function did not throw`, description);
  const { error } = thrown;
  if (typeof error !== "object" || error === null || error.constructor !== constructor)
    fail(`assert_throws_js: function threw ${format(error)} (${String(error)}), not a ${constructor.name}`, description);
};

process.on("exit", () => {
  process.stdout.write(JSON.stringify(results));
});
