// Whose rules the matchers of an expect() follow, "vitest" or "bun:test", where the runner can't name one running test.
// Not in vitest-flavor.test.ts: a debug build takes about a minute for that file, and seconds for this one.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTests(files: Record<string, string>, args: readonly string[] = [], read: string[] = []) {
  using dir = tempDir("vitest-flavor-expect", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    results: stderr
      .split("\n")
      .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    written: await Promise.all(read.map(path => Bun.file(`${dir}/${path}`).text())),
    exitCode,
  };
}

// In a fixture, `sides(expect)` is "vitest" or "jest": the runner that the matchers of that `expect` side with.
// Both rules pass in "bun:test". Both fail in "vitest": its .not.not is still negated, and it counts the missing item.
// The matcher reads the first rule, and deep equality reads the second. "jest and vitest" means that they disagree.
const sides = `
  const passes = fn => { try { fn(); return true; } catch { return false; } };
  const sides = expect => [...new Set([
    passes(() => expect(1).not.not.toBe(1)),
    passes(() => expect(["a"]).toEqual(["a", undefined])),
  ].map(passed => (passed ? "jest" : "vitest")))].join(" and ");
`;

// `flavorOf(expect)` reads every rule where the two runners disagree. If the rules disagree, it is the list of their outcomes.
const flavorOf = `
  const flavorOf = async expect => {
    const outcome = fn => { try { fn(); return "passes"; } catch (error) { return error instanceof TypeError ? "TypeError" : "fails"; } };
    let promise;
    try { promise = expect(Promise.resolve(1)).resolves.toBe(2); } catch {}
    const outcomes = [
      outcome(() => expect(1).not.not.toBe(1)),
      outcome(() => expect("abc1").toContain(1)),
      outcome(() => expect({ "a.b": 1 }).toHaveProperty("a.b")),
      outcome(() => expect(undefined).not.toHaveProperty("a")),
      outcome(() => expect("text").not.toMatchObject({ a: 1 })),
      outcome(() => expect(["a"]).toEqual(["a", undefined])),
      promise ? "returns a promise" : "throws",
    ];
    await promise?.catch(() => {});
    outcomes.push(await expect(Promise.resolve(new Error("message"))).resolves.toThrow().then(() => "passes", () => "fails"));
    const all = outcomes.join(", ");
    if (all === "fails, passes, passes, TypeError, passes, fails, returns a promise, fails") return "vitest";
    if (all === "passes, fails, fails, passes, fails, passes, throws, passes") return "jest";
    return all;
  };
`;

// Vitest 5.0 answers "vitest" at each of these in a file that imports "vitest".
const hooksAndTests = [
  "beforeAll",
  "beforeEach",
  "test",
  "afterEach",
  "afterAll",
  "beforeEach of concurrent tests",
  "concurrent test, before its first await",
  "concurrent test, after an await",
  "afterEach of concurrent tests",
];
// Vitest 5.0 answers "vitest" at these too. Here no test or hook is running, and `expect` is one function for every module.
const outsideOfATest = [
  "top level",
  "describe body",
  "expect() kept from the top level",
  "expect() kept from a describe body",
];
// Prints the flavor of `expect` at each position. With "" for `module`, the file uses the globals.
const everyPosition = (module: string) => `
  ${module ? `import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "${module}";` : ""}
  ${flavorOf}
  const seen = {};
  for (const position of ${JSON.stringify([...hooksAndTests, ...outsideOfATest])}) seen[position] = "not reached";
  const at = async position => { seen[position] = await flavorOf(expect); };
  const kept = { "the top level": expect(1) };

  await at("top level");
  describe("block", async () => {
    kept["a describe body"] = expect(1);
    await at("describe body");
    beforeAll(() => at("beforeAll"));
    beforeEach(() => at("beforeEach"));
    afterEach(() => at("afterEach"));
    afterAll(() => at("afterAll"));
    test("test", async () => {
      await at("test");
      for (const [where, expectation] of Object.entries(kept)) {
        seen["expect() kept from " + where] = "vitest";
        try { expectation.not.not.toBe(1); seen["expect() kept from " + where] = "jest"; } catch {}
      }
    });
    // With --concurrent, the two tests of this block run in one group.
    test("another test", async () => { await 1; });
  });
  describe.concurrent("concurrent block", () => {
    beforeEach(() => at("beforeEach of concurrent tests"));
    afterEach(() => at("afterEach of concurrent tests"));
    test("first", async () => {
      const before = flavorOf(expect);
      await 1;
      seen["concurrent test, before its first await"] = await before;
      await at("concurrent test, after an await");
    });
    test("second", async () => { await 1; });
  });
  afterAll(() => { for (const position in seen) console.log(position + ": " + seen[position]); });
`;
const everywhere = (inATest: string) => [
  ...hooksAndTests.map(position => `${position}: ${inATest}`),
  ...outsideOfATest.map(position => `${position}: jest`),
];

test.concurrent.each([
  ["imports vitest", [], "vitest", "vitest"],
  ["imports vitest", ["--concurrent"], "vitest", "vitest"],
  ["uses the globals", ["--globals=vitest", "--concurrent"], "", "vitest"],
  ["imports bun:test", [], "bun:test", "jest"],
  ["imports bun:test", ["--concurrent"], "bun:test", "jest"],
  ["imports @jest/globals", ["--concurrent"], "@jest/globals", "jest"],
])("a file that %s follows that module in every hook and test: bun test %j", async (_, args, module, flavor) => {
  const { log, exitCode } = await runTests({ "a.test.js": everyPosition(module) }, args);
  expect({ log, exitCode }).toEqual({ log: everywhere(flavor), exitCode: 0 });
});

test.concurrent("the test decides. Concurrent tests of both modules follow bun:test", async () => {
  const { log, exitCode } = await runTests({
    "a.test.js": `
      import * as bun from "bun:test";
      import * as vitest from "vitest";
      ${sides}
      const modules = { bun, vitest };
      const seen = {};
      const record = (where, expect, goOn = () => {}) => {
        seen[where] = "not reached";
        return async () => {
          const before = sides(expect);
          await goOn();
          seen[where] = before + ", then " + sides(expect);
        };
      };
      for (const testOf in modules) {
        for (const expectOf in modules) {
          modules[testOf].test("test", record("test of " + testOf + ", expect of " + expectOf, modules[expectOf].expect));
        }
      }
      // The tests below run in one group, so the runner can't tell which of them calls.
      const allStarted = Promise.withResolvers();
      const concurrent = (testOf, expectOf, goOn = () => allStarted.promise) => {
        const where = "concurrent test of " + testOf + ", expect of " + expectOf;
        modules[testOf].test.concurrent("concurrent test", record(where, modules[expectOf].expect, goOn));
      };
      concurrent("vitest", "bun");
      concurrent("vitest", "vitest");
      // The context knows its test.
      const ofContext = "concurrent test of vitest, expect of its context";
      seen[ofContext] = "not reached";
      vitest.test.concurrent("concurrent test", ({ expect }) => record(ofContext, expect, () => allStarted.promise)());
      concurrent("bun", "vitest");
      // It starts last. So a test of "bun:test" is what started last when the tests above go on.
      concurrent("bun", "bun", () => allStarted.resolve());
      bun.afterAll(() => { for (const where in seen) console.log(where + ": " + seen[where]); });
    `,
  });
  expect({ log, exitCode }).toEqual({
    log: [
      "test of bun, expect of bun: jest, then jest",
      "test of bun, expect of vitest: jest, then jest",
      "test of vitest, expect of bun: vitest, then vitest",
      "test of vitest, expect of vitest: vitest, then vitest",
      "concurrent test of vitest, expect of bun: jest, then jest",
      "concurrent test of vitest, expect of vitest: jest, then jest",
      "concurrent test of vitest, expect of its context: vitest, then vitest",
      "concurrent test of bun, expect of vitest: jest, then jest",
      "concurrent test of bun, expect of bun: jest, then jest",
    ],
    exitCode: 0,
  });
});

// Two tests of `module` that call `expectation` before and after an await. Prints the sides that they saw.
const twoTests = (module: string, expectation: string) => `
  import { afterAll, test } from "${module}";
  ${sides}
  const seen = [];
  const body = async () => { seen.push(sides(${expectation})); await 1; seen.push(sides(${expectation})); };
  test("first", body);
  test("second", body);
  afterAll(() => console.log([...new Set(seen)].join(", ")));
`;
const withHelper = (tests: string, helper: string) => ({
  "a.test.js": `import { expectOfHelper } from "./helper.js";${twoTests(tests, "expectOfHelper")}`,
  "helper.js": `import { expect } from "${helper}"; export const expectOfHelper = expect;`,
});
const withPreload = {
  "a.test.js": `import { test } from "vitest"; test("first", async () => { await 1; }); test("second", async () => { await 1; });`,
  "preload.js": `
    import { afterAll, beforeEach, expect } from "bun:test";
    ${sides}
    const seen = [];
    beforeEach(async () => { seen.push(sides(expect)); await 1; seen.push(sides(expect)); });
    afterAll(() => console.log([...new Set(seen)].join(", ")));
  `,
};
// A test that test.for() or test.extend() of "bun:test" makes is a test of "vitest".
const forAndExtend = (plain: string) => ({
  "a.test.js": `
    import { afterAll, expect, test } from "bun:test";
    ${sides}
    const seen = new Set();
    const body = where => async () => { seen.add(where + ": " + sides(expect)); await 1; seen.add(where + ": " + sides(expect)); };
    test.for([1, 2])("row %i", body("test.for()"));
    test.extend({ fixture: 1 })("extended", body("test.extend()"));
    ${plain}
    afterAll(() => console.log([...seen].join(", ")));
  `,
});
const plainTest = `test("plain", body("plain test"));`;
const forAndExtendFollowVitest = "test.for(): vitest, test.extend(): vitest";
// The name, the files, the arguments, and what the tests print when they are serial and when they are concurrent.
const cells: [string, Record<string, string>, string[], string, string][] = [
  ["tests of bun:test, expect of a helper that imports vitest", withHelper("bun:test", "vitest"), [], "jest", "jest"],
  [
    "tests of vitest, expect of a helper that imports bun:test",
    withHelper("vitest", "bun:test"),
    [],
    "vitest",
    "vitest",
  ],
  [
    "tests of vitest, beforeEach and expect of a preload of bun:test",
    withPreload,
    ["--preload=./preload.js"],
    "vitest",
    "vitest",
  ],
  [
    "tests of bun:test, global expect of vitest",
    { "a.test.js": twoTests("bun:test", "expect") },
    ["--globals=vitest"],
    "jest",
    "jest",
  ],
  [
    "tests of test.for() and test.extend() of bun:test",
    forAndExtend(""),
    [],
    forAndExtendFollowVitest,
    forAndExtendFollowVitest,
  ],
  [
    "tests of test.for() and test.extend() of bun:test beside a plain test",
    forAndExtend(plainTest),
    [],
    forAndExtendFollowVitest + ", plain test: jest",
    // One group has tests of both modules.
    "test.for(): jest, test.extend(): jest, plain test: jest",
  ],
];
for (const [name, files, args, serial, concurrent] of cells) {
  test.concurrent.each([
    [args, serial],
    [[...args, "--concurrent"], concurrent],
  ])(`${name}: bun test %j`, async (args, seen) => {
    const { log, exitCode } = await runTests(files, args);
    expect({ log, exitCode }).toEqual({ log: [seen], exitCode: 0 });
  });
}

test.concurrent("the expect of a test context follows its test, also where the runner knows no test", async () => {
  const { log, exitCode } = await runTests({
    "a.test.js": `
      import * as bun from "bun:test";
      import * as vitest from "vitest";
      ${sides}
      const polled = expect => expect.poll(() => "abc1", { interval: 1, timeout: 50 }).toContain(1).then(() => "vitest", () => "jest");
      const kept = {};
      vitest.test("test of vitest", ({ expect }) => { kept.vitest = expect; });
      // A test of "bun:test" has a context in a hook of "vitest".
      bun.describe("block", () => {
        vitest.beforeEach(({ expect }) => { kept.bun = expect; });
        bun.test("test of bun", () => {});
      });
      // This group has tests of both modules, so the runner knows no module for it.
      bun.test.concurrent("first", async () => {
        await 1;
        for (const [testOf, expect] of Object.entries(kept)) {
          // A failed expect.soft() matcher throws here, because its test has ended.
          const seen = ["expect " + sides(expect), "soft " + sides(expect.soft), "poll " + (await polled(expect))];
          console.log("context of a test of " + testOf + ": " + seen.join(", "));
        }
      });
      vitest.test.concurrent("second", async () => { await 1; });
    `,
  });
  expect({ log, exitCode }).toEqual({
    log: [
      "context of a test of vitest: expect vitest, soft vitest, poll vitest",
      "context of a test of bun: expect jest, soft jest, poll jest",
    ],
    exitCode: 0,
  });
});

test.concurrent("expect.poll() follows the expect() that it was called on", async () => {
  const { log, exitCode } = await runTests({
    "a.test.js": `
      import * as bun from "bun:test";
      import * as vitest from "vitest";
      const settle = matcher => matcher.then(() => "passes", () => "fails");
      const polled = async expect => {
        const poll = value => expect.poll(value, { interval: 1, timeout: 50 });
        const later = () => ({ later: Promise.resolve().then(() => 1), items: ["a"] });
        return [
          // "vitest" converts 1 to a string, and counts the missing item.
          await settle(poll(() => "abc1").toContain(1)),
          await settle(poll(() => ["a"]).toEqual(["a", undefined])),
          // This matcher waits for the promise, and then compares again.
          await settle(poll(later).toEqual({ later: expect.resolvesTo.any(Number), items: ["a", undefined] })),
        ].join(", ");
      };
      vitest.test("test of vitest", async ({ expect }) => {
        console.log("test of vitest:", await polled(vitest.expect));
        console.log("test of vitest, expect of its context:", await polled(expect));
      });
      bun.test("test of bun", async () => { console.log("test of bun:", await polled(bun.expect)); });
    `,
  });
  expect({ log, exitCode }).toEqual({
    log: [
      "test of vitest: passes, fails, fails",
      "test of vitest, expect of its context: passes, fails, fails",
      "test of bun: fails, passes, passes",
    ],
    exitCode: 0,
  });
});

// A failed expect.soft() matcher fails its test, and a failed expect.poll() matcher rejects.
test.concurrent.each([
  ["vitest", []],
  ["vitest", ["--concurrent"]],
  ["bun:test", []],
  ["bun:test", ["--concurrent"]],
])("expect.soft() and expect.poll() in tests of %s: bun test %j", async (module, args) => {
  const ofVitest = module === "vitest";
  // Each of these passes with the rules of the module, and fails with the rules of the other one.
  const notNot = ofVitest ? `.not.not.toBe(2)` : `.not.not.toBe(1)`;
  const ownKey = ofVitest ? `.toHaveProperty("a.b")` : `.not.toHaveProperty("a.b")`;
  const missingItem = ofVitest ? `.not.toEqual(["a", undefined])` : `.toEqual(["a", undefined])`;
  // Only a test of "vitest" has a context.
  const [parameter, soft, poll] = ofVitest
    ? ["{ expect: ofContext }", "soft(ofContext);", "await poll(ofContext);"]
    : ["", "", ""];
  const files = {
    "a.test.js": `
      import { expect, test } from "${module}";
      const soft = expect => {
        expect.soft(1)${notNot};
        expect.soft({ "a.b": 1 })${ownKey};
        expect.soft(["a"])${missingItem};
      };
      const poll = async expect => {
        const options = { interval: 1, timeout: 50 };
        await expect.poll(() => 1, options)${notNot};
        await expect.poll(() => ({ "a.b": 1 }), options)${ownKey};
        await expect.poll(() => ["a"], options)${missingItem};
      };
      test("soft", async (${parameter}) => {
        soft(expect);
        ${soft}
        await 1;
        soft(expect);
        ${soft}
      });
      test("poll", async (${parameter}) => {
        await poll(expect);
        ${poll}
      });
    `,
  };
  const { results, exitCode } = await runTests(files, args);
  expect({ results, exitCode }).toEqual({ results: ["(pass) soft", "(pass) poll"], exitCode: 0 });
});

test.concurrent("a matcher follows its own expect() inside a matcher of the other module", async () => {
  const { log, exitCode } = await runTests({
    "a.test.js": `
      import * as bun from "bun:test";
      import * as vitest from "vitest";
      const passes = fn => { try { fn(); return true; } catch { return false; } };
      const side = passed => (passed ? "jest" : "vitest");
      bun.expect.extend({
        toEqualAMissingItem(received) { return { pass: this.equals(received, ["a", undefined]), message: () => "" }; },
        toRun(received) { received(); return { pass: this.equals(["a"], ["a", undefined]), message: () => "" }; },
      });
      // An expect() object follows the test that it was made in.
      const kept = {};
      bun.test("make", () => { kept.bun = bun.expect(["a"]); });
      vitest.test("make", () => { kept.vitest = vitest.expect(["a"]); });

      let inATester;
      bun.expect.addEqualityTesters([(a, b) => { if (a === "tester" && b === "tester") inATester?.(); }]);
      for (const [testOf, { expect, test }] of Object.entries({ bun, vitest })) {
        test("test of " + testOf, () => {
          const inner = kept[testOf === "bun" ? "vitest" : "bun"];
          // toEqual() asks from deep equality. The custom matcher asks from this.equals().
          const asked = () => [passes(() => inner.toEqual(["a", undefined])), passes(() => inner.toEqualAMissingItem())];
          const run = () => [...new Set(asked().map(side))].join(" and ");
          const say = (where, nested, outer) => console.log("test of " + testOf + ", " + where + ": nested " + nested + outer);
          let nested;
          expect(1).toSatisfy(() => { nested = run(); return true; });
          say("in a toSatisfy() predicate", nested, "");

          nested = undefined;
          // Deep equality reads "first", and then compares "second".
          const received = { get first() { nested ??= run(); return 1; }, second: ["a"] };
          let outer = passes(() => expect(received).toEqual({ first: 1, second: ["a", undefined] }));
          say("in a getter", nested, ", then outer " + side(outer));

          nested = undefined;
          inATester = () => { inATester = undefined; nested = run(); };
          outer = passes(() => expect(["tester", ["a"]]).toEqual(["tester", ["a", undefined]]));
          say("in an equality tester", nested, ", then outer " + side(outer));

          outer = passes(() => expect(() => { nested = run(); }).toRun());
          say("in a custom matcher", nested, ", then outer " + side(outer));
        });
      }
    `,
  });
  const inside = (testOf: string, outer: string, nested: string) => [
    `test of ${testOf}, in a toSatisfy() predicate: nested ${nested}`,
    `test of ${testOf}, in a getter: nested ${nested}, then outer ${outer}`,
    `test of ${testOf}, in an equality tester: nested ${nested}, then outer ${outer}`,
    `test of ${testOf}, in a custom matcher: nested ${nested}, then outer ${outer}`,
  ];
  expect({ log, exitCode }).toEqual({
    log: [...inside("bun", "jest", "vitest"), ...inside("vitest", "vitest", "jest")],
    exitCode: 0,
  });
});

test.concurrent("deep equality that no matcher asked for follows what started last", async () => {
  const { log, exitCode } = await runTests({
    "a.test.js": `
      import * as bun from "bun:test";
      import * as vitest from "vitest";
      bun.expect.extend({
        async toEqualAfterAnAwait(received, expected) {
          const { equals } = this;
          await 1;
          return { pass: equals(received, expected), message: () => "" };
        },
        toEqualAMissingItem(received) { return { pass: this.equals(received, ["a", undefined]), message: () => "" }; },
      });
      const side = passed => (passed ? "jest" : "vitest");
      for (const [testOf, { expect, test }] of Object.entries({ bun, vitest })) {
        test("test of " + testOf, async () => {
          const kept = await expect(["a"]).toEqualAfterAnAwait(["a", undefined]).then(() => true, () => false);
          const direct = expect.toEqualAMissingItem().asymmetricMatch(["a"]);
          console.log("test of " + testOf + ": equals() kept over an await " + side(kept) + ", asymmetricMatch() called directly " + side(direct));
        });
      }
    `,
  });
  expect({ log, exitCode }).toEqual({
    log: [
      "test of bun: equals() kept over an await jest, asymmetricMatch() called directly jest",
      "test of vitest: equals() kept over an await vitest, asymmetricMatch() called directly vitest",
    ],
    exitCode: 0,
  });
});

// The second run of the file starts with what the first run left behind.
test.concurrent("--rerun-each: the top level of the file follows bun:test in every run", async () => {
  const files = {
    "a.test.js": `
      import { aroundEach, expect, test } from "bun:test";
      ${sides}
      console.log("top level:", sides(expect));
      aroundEach(async runTest => { console.log("aroundEach:", sides(expect)); await runTest(); });
      test("plain", () => { console.log("plain test:", sides(expect)); });
      // This is a test of "vitest", and it runs last.
      test.for([1])("row %i", () => { console.log("test of test.for():", sides(expect)); });
    `,
  };
  const { log, exitCode } = await runTests(files, ["--rerun-each=2"]);
  const run = [
    "top level: jest",
    "aroundEach: jest",
    "plain test: jest",
    "aroundEach: vitest",
    "test of test.for(): vitest",
  ];
  expect({ log, exitCode }).toEqual({ log: [...run, ...run], exitCode: 0 });
});

const headers = {
  bun: "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots",
  vitest: "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html",
};
const lines = (text: string) => text.split("\n").filter(line => line);

test.concurrent("concurrent tests of vitest write their snapshots in the format of Vitest", async () => {
  const files = {
    "a.test.js": `
      import { expect, test } from "vitest";
      test.concurrent("first", async ({ expect: ofContext }) => {
        await 1;
        expect(() => { throw new Error("thrown"); }).toThrowErrorMatchingInlineSnapshot();
        ofContext("value").toMatchSnapshot();
      });
      test.concurrent("second", async () => { await 1; });
    `,
  };
  const { results, written, exitCode } = await runTests(files, [], ["a.test.js", "__snapshots__/a.test.js.snap"]);
  expect(written[0]).toContain("toThrowErrorMatchingInlineSnapshot(`[Error: thrown]`)");
  expect(lines(written[1])).toEqual([headers.vitest, 'exports[`first 1`] = `"value"`;']);
  expect({ results, exitCode }).toEqual({ results: ["(pass) first", "(pass) second"], exitCode: 0 });
});

test.concurrent.each([
  [["bun.test.js", "vitest.test.js"]],
  [["vitest.test.js", "bun.test.js"]],
  [["-t", "stores"]],
  [["--randomize", "--seed=1"]],
])("a snapshot file has the format of its test file's module: bun test %j", async args => {
  const file = (module: string) => `
    import { test } from "${module}";
    import { snapshot } from "./helper.js";
    // A snapshot matcher can't tell which of two concurrent tests called it, so it throws.
    test.concurrent("first", async () => { await 1; try { snapshot("first"); } catch {} });
    test.concurrent("second", async () => { await 1; });
    test("stores", () => { snapshot("value"); });
  `;
  const files = {
    "helper.js": `import { expect } from "bun:test"; export const snapshot = value => expect(value).toMatchSnapshot();`,
    "bun.test.js": file("bun:test"),
    "vitest.test.js": file("vitest"),
  };
  const snapshots = ["__snapshots__/bun.test.js.snap", "__snapshots__/vitest.test.js.snap"];
  const { written, exitCode } = await runTests(files, args, snapshots);
  expect({ written: written.map(text => lines(text)[0]), exitCode }).toEqual({
    written: [headers.bun, headers.vitest],
    exitCode: 0,
  });
});
