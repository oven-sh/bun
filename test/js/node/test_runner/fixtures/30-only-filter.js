// Passes as it is under `node --test --test-only`, and under `node --test` with NODE_TEST_ONLY_FIXTURE=all.
const assert = require("node:assert");
const { test, describe, it, suite, before, after } = require("node:test");

const focused = process.env.NODE_TEST_ONLY_FIXTURE !== "all";

const expectedFocused = [
  "HOOK root before",
  "RAN only modifier",
  "RAN only option",
  "RAN it.only alias",
  "RAN modifier beats only false",
  "HOOK only suite before",
  "RAN only suite > inherits",
  "HOOK nested plain before",
  "RAN nested plain > inherits",
  "HOOK only suite after",
  "RAN option suite > narrows",
  "HOOK plain suite before",
  "RAN plain suite > focused child",
  "HOOK plain suite after",
];
const expectedAll = [
  "HOOK root before",
  "RAN only modifier",
  "RAN only option",
  "RAN it.only alias",
  "RAN plain",
  "RAN only false",
  "RAN modifier beats only false",
  "HOOK only suite before",
  "RAN only suite > inherits",
  "RAN only suite > opts out",
  "HOOK nested plain before",
  "RAN nested plain > inherits",
  "RAN nested only false > never",
  "HOOK only suite after",
  "RAN option suite > narrowed out",
  "RAN option suite > narrows",
  "HOOK plain suite before",
  "RAN plain suite > focused child",
  "RAN plain suite > plain child",
  "HOOK plain suite after",
  "RAN nothing to run > unmarked sibling",
  "HOOK unmarked suite before",
  "RAN unmarked suite > child",
];
const seen = [];
const see = line => seen.push(line);
let onlyFalseSuiteDeclared = false;

before(() => see("HOOK root before"));
after(() => {
  assert.strictEqual(onlyFalseSuiteDeclared, !focused);
  assert.deepStrictEqual(seen, focused ? expectedFocused : expectedAll);
});

test.only("only modifier", () => see("RAN only modifier"));
test("only option", { only: true }, () => see("RAN only option"));
it.only("it.only alias", () => see("RAN it.only alias"));
test("plain", () => see("RAN plain"));
test("only false", { only: false }, () => see("RAN only false"));
test.only("modifier beats only false", { only: false }, () => see("RAN modifier beats only false"));
test.only("only todo", { todo: true });
test.only("only skip", { skip: true }, () => see("RAN only skip"));

// A declaration that the filter drops is still checked.
assert.throws(() => test("invalid", { only: false, expectFailure: {} }, () => {}), { code: "ERR_INVALID_ARG_VALUE" });
assert.throws(() => test("invalid", { only: false, timeout: -1 }, () => {}), { code: "ERR_OUT_OF_RANGE" });

describe.only("only suite", () => {
  before(() => see("HOOK only suite before"));
  after(() => see("HOOK only suite after"));
  test("inherits", () => see("RAN only suite > inherits"));
  test("opts out", { only: false }, () => see("RAN only suite > opts out"));
  describe("nested plain", () => {
    before(() => see("HOOK nested plain before"));
    test("inherits", () => see("RAN nested plain > inherits"));
  });
  describe("nested only false", { only: false }, () => {
    onlyFalseSuiteDeclared = true;
    test("never", () => see("RAN nested only false > never"));
  });
});

suite("option suite", { only: true }, () => {
  test("narrowed out", () => see("RAN option suite > narrowed out"));
  test.only("narrows", () => see("RAN option suite > narrows"));
});

describe("plain suite", () => {
  before(() => see("HOOK plain suite before"));
  after(() => see("HOOK plain suite after"));
  test.only("focused child", () => see("RAN plain suite > focused child"));
  test("plain child", () => see("RAN plain suite > plain child"));
});

// A marked entry selects its suite when it is declared, with or without a test to run in it.
describe("suite with marked entries that run nothing", () => {
  test.only("marked skip", { skip: true }, () => see("RAN nothing to run > marked skip"));
  test.only("marked todo", { todo: true });
  describe.only("marked empty suite", () => {});
  test("unmarked sibling", () => see("RAN nothing to run > unmarked sibling"));
});

describe("unmarked suite", () => {
  before(() => see("HOOK unmarked suite before"));
  test("child", () => see("RAN unmarked suite > child"));
});

describe.skip("skipped suite", () => {
  test("never", () => see("RAN skipped suite > never"));
});
describe("suite skipped by option", { skip: true }, () => {
  test("never", () => see("RAN suite skipped by option > never"));
});
describe.only("marked skipped suite", { skip: true }, () => {
  test("never", () => see("RAN marked skipped suite > never"));
});
