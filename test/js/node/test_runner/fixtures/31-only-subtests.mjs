// Passes as it is under `node --test --test-only`, and under `node --test` with NODE_TEST_ONLY_FIXTURE=all.
import assert from "node:assert";
import { after, test } from "node:test";

const focused = process.env.NODE_TEST_ONLY_FIXTURE !== "all";

const expectedFocused = [
  "RAN created > before the marker",
  "RAN created > marker",
  "RAN runOnly > marked",
  "RAN runOnly > marked > subtest",
  "RAN runOnly > after runOnly(false)",
  "RAN only false > kept",
  "RAN plan > marker",
  "HOOK beforeEach",
  "RAN hooks > marker",
  "RAN order > slow ends",
  "order > filtered resolved",
  "RAN checked",
  "RAN together > first",
  "RAN together > third",
  "RAN loop > two",
  "RAN loop > three",
];
const expectedAll = [
  "RAN created > before the marker",
  "RAN created > marker",
  "RAN created > after the marker",
  "RAN runOnly > not marked",
  "RAN runOnly > marked",
  "RAN runOnly > marked > subtest",
  "RAN runOnly > after runOnly(false)",
  "RAN runOnly > after runOnly(false) > not marked",
  "RAN only false > kept",
  "RAN only false > dropped",
  "RAN plan > marker",
  "RAN plan > filtered",
  "HOOK beforeEach",
  "RAN hooks > marker",
  "HOOK beforeEach",
  "RAN hooks > filtered",
  "RAN order > slow ends",
  "RAN order > filtered",
  "order > filtered resolved",
  "RAN checked",
  "RAN together > first",
  "RAN together > second",
  "RAN together > third",
  "RAN loop > one",
  "RAN loop > two",
  "RAN loop > three",
  "RAN not marked > never",
];
const seen = [];
const see = line => seen.push(line);

after(() => assert.deepStrictEqual(seen, focused ? expectedFocused : expectedAll));

test.only("a subtest is decided when it is created", async t => {
  await t.test("before the marker", () => see("RAN created > before the marker"));
  await t.test("marker", { only: true }, () => see("RAN created > marker"));
  await t.test("after the marker", () => see("RAN created > after the marker"));
  await t.test("skipped after the marker", { skip: true }, () => see("RAN created > skipped after the marker"));
});

test.only("runOnly", async t => {
  t.runOnly(true);
  await t.test("not marked", () => see("RAN runOnly > not marked"));
  await t.test("marked", { only: true }, async t => {
    see("RAN runOnly > marked");
    await t.test("a subtest of a marked subtest", () => see("RAN runOnly > marked > subtest"));
  });
  t.runOnly(false);
  await t.test("after runOnly(false)", async t => {
    see("RAN runOnly > after runOnly(false)");
    t.runOnly(true);
    await t.test("not marked", () => see("RAN runOnly > after runOnly(false) > not marked"));
  });
});

test.only("only false", async t => {
  await t.test("kept", () => see("RAN only false > kept"));
  await t.test("dropped", { only: false }, () => see("RAN only false > dropped"));
});

test.only("a filtered subtest counts against the plan", async t => {
  t.plan(2);
  await t.test("marker", { only: true }, () => see("RAN plan > marker"));
  await t.test("filtered", () => see("RAN plan > filtered"));
});

test.only("a filtered subtest runs no hook", async t => {
  t.beforeEach(() => see("HOOK beforeEach"));
  await t.test("marker", { only: true }, () => see("RAN hooks > marker"));
  await t.test("filtered", () => see("RAN hooks > filtered"));
});

test.only("a filtered subtest resolves after its earlier sibling", async t => {
  t.runOnly(true);
  const slow = t.test("slow", { only: true }, async () => {
    await new Promise(resolve => setImmediate(resolve));
    see("RAN order > slow ends");
  });
  const filtered = t.test("filtered", () => see("RAN order > filtered"));
  assert.strictEqual(typeof filtered.then, "function");
  await filtered;
  see("order > filtered resolved");
  await slow;
});

test.only("a filtered subtest is still checked", async t => {
  t.runOnly(true);
  assert.throws(() => t.test("invalid", { expectFailure: {} }, () => {}), { code: "ERR_INVALID_ARG_VALUE" });
  see("RAN checked");
});

test.only("subtests that start together under runOnly()", async t => {
  t.runOnly(true);
  await Promise.all([
    t.test("first", { only: true }, () => see("RAN together > first")),
    t.test("second", () => see("RAN together > second")),
    t.test("third", { only: true }, () => see("RAN together > third")),
  ]);
});

test.only("an only option that is computed in a loop", async t => {
  for (const name of ["one", "two", "three"]) {
    await t.test(name, { only: name !== "one" }, () => see(`RAN loop > ${name}`));
  }
});

test("not marked", async t => {
  await t.test("never", { only: true }, () => see("RAN not marked > never"));
});
