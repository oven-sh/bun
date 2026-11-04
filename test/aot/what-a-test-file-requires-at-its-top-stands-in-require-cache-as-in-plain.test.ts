import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const head = `
  const { test } = require("bun:test");
  const path = require("node:path");
  const names = list => list.map(entry => path.basename(entry.id)).join();
  const keys = () => Object.keys(require.cache).map(key => path.basename(key)).join();`;

const family = {
  "parent.cjs": `exports.child = require("./child.cjs").named;\nexports.other = require("./other.cjs");`,
  "child.cjs": `exports.named = 1;`,
  "other.cjs": `exports.named = 2;`,
};

const waysToTheEntry = {
  "the chain in one piece": `names(require.cache[require.resolve("./parent.cjs")].children) + " " + path.basename(require.cache[require.resolve("./child.cjs")].parent.id)`,
  "the entry in a variable": `(() => { const entry = require.cache[require.resolve("./parent.cjs")]; return names(entry.children) + " " + path.basename(entry.children[0].parent.id); })()`,
  "a key out of the list": `Object.keys(require.cache).filter(key => key.endsWith("parent.cjs")).map(key => names(require.cache[key].children)).join()`,
};

for (const [title, expression] of Object.entries(waysToTheEntry)) {
  test(`the children and the parent of an entry: ${title}`, async () => {
    await expectCompiledToRunAsPlain({
      ...family,
      "one.test.cjs": `${head}
        const parent = require("./parent.cjs");
        const atTop = ${expression};
        test("both", () => { console.log(atTop, "|", ${expression}, parent.child); });`,
    });
  });
}

test("a file stands in front of what it requires", async () => {
  await expectCompiledToRunAsPlain({
    "a.cjs": `exports.b = require("./b.cjs");`,
    "b.cjs": `exports.c = require("./c.cjs");`,
    "c.cjs": `exports.n = 1;`,
    "one.test.cjs": `${head}
      const a = require("./a.cjs");
      const atTop = keys();
      test("keys", () => { console.log(atTop, "|", keys(), a.b.c.n); });`,
  });
});

test("what two files require stands behind the first of them", async () => {
  await expectCompiledToRunAsPlain({
    "a.cjs": `exports.c = require("./c.cjs");\nexports.n = 1;`,
    "b.cjs": `exports.c = require("./c.cjs");\nexports.n = 2;`,
    "c.cjs": `exports.n = 3;`,
    "one.test.cjs": `${head}
      const b = require("./b.cjs");
      const a = require("./a.cjs");
      test("keys", () => { console.log(keys(), a.n + b.n); });`,
  });
});

test("two files that require each other", async () => {
  await expectCompiledToRunAsPlain({
    "a.cjs": `exports.early = 1;\nexports.b = require("./b.cjs");`,
    "b.cjs": `exports.seen = Object.keys(require("./a.cjs")).join();\nexports.keys = Object.keys(require.cache).map(key => key.replace(/.*[\\\\/]/, "")).join();`,
    "one.test.cjs": `${head}
      const a = require("./a.cjs");
      test("keys", () => { console.log(a.b.keys, "|", keys(), a.b.seen); });`,
  });
});

// The loader asks for everything that the ES modules of one level import before any of it runs. What stands for beside.cjs in the loader, for the name that is imported, is no file.
test("what an ES module imports stands there from when the loader asks for it", async () => {
  const lists = (name: string) => `console.log("${name}", Object.keys(require.cache).map(key => key.replace(/.*[\\\\/]/, "")).join());`;
  await expectCompiledToRunAsPlain({
    "graph.mjs": `import "./first.cjs";\nimport beside from "./beside.cjs";\nimport "./deeper.mjs";\nconsole.log(beside);`,
    "deeper.mjs": `import "./below.cjs";`,
    "first.cjs": `${lists("first")}\nrequire("./own.cjs");`,
    "own.cjs": lists("own"),
    "beside.cjs": `${lists("beside")}\nmodule.exports = 2;`,
    "below.cjs": lists("below"),
    "one.test.cjs": `${head}
      require("./graph.mjs");
      test("keys", () => { console.log(keys()); });`,
  });
});
