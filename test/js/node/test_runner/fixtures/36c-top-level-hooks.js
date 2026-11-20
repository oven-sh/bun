const { describe, it, afterEach } = require("node:test");

// This file fails on purpose. A module-level and a suite-level afterEach hook
// read the outcome of the tests of a suite. The process prints what the hooks saw.
const seen = [];
function record(where, ctx) {
  const { passed, error } = ctx;
  const cause = error?.cause;
  seen.push(
    JSON.stringify({
      where,
      name: ctx.name,
      passed,
      code: error?.code,
      failureType: error?.failureType,
      message: error?.message,
      cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : cause,
    }),
  );
}

afterEach(ctx => record("file", ctx));

describe("suite", () => {
  afterEach(ctx => record("suite", ctx));
  it("throws", () => {
    throw new TypeError("boom");
  });
  it("passes", () => {});
  it("fails as expected", { expectFailure: true }, () => {
    throw new Error("expected");
  });
  it("times out", { timeout: 5 }, () => new Promise(() => {}));
});

process.on("exit", () => {
  for (const line of seen) console.log("SEEN " + line);
});
