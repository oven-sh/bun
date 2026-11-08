// Files of a package star one another in a ring, a CommonJS file stands behind one of them, and a test mocks every file of the ring. Inside the package the
// mocks do not take: each importer sees the file itself, so the names behind a star are those of that file's own namespace. Such a namespace is made in the
// middle of the making of another: where it comes round to the one that is still being made it finds no names there yet. It served that walk and was then
// kept: whoever came into the ring by another door later lost the names of the CommonJS file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const say = `const said = space => Object.keys(space).sort().map(key => key + "=" + String(Reflect.get(space, key))).join();`;

async function bothRuns(kit: Record<string, string>, mocked: string[], doors: [string, string]) {
  using dir = tempDir("a-ring-of-mocked-files-of-a-package", {
    "package.json": `{ "name": "made-up", "type": "module" }`,
    "node_modules/kit/package.json": `{ "name": "kit", "version": "1.0.0", "type": "module" }`,
    ...Object.fromEntries(Object.entries(kit).map(([name, text]) => [`node_modules/kit/${name}`, text])),
    "whole.mjs": `import * as one from "kit/${doors[0]}";\nimport * as other from "kit/${doors[1]}";\n${say}\nexport const look = () => said(one) + " | " + said(other);\n`,
    "a.test.js": `
      import { test, vi } from "bun:test";
      test("the namespaces", async () => {
        ${mocked.map(file => `vi.doMock("kit/${file}", () => ({ mocked: true }));`).join("\n        ")}
        console.log("SAID", (await import("./whole.mjs")).look());
      });
    `,
  });
  const outcome = async (...flags: string[]) => {
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "./a.test.js"], String(dir), bunEnv);
    return {
      said: stdout
        .split("\n")
        .filter(line => line.startsWith("SAID "))
        .join(),
      exitCode,
    };
  };
  return { plain: await outcome(), compiled: await outcome("--aot") };
}

function twice(names: string) {
  const outcome = { said: `SAID ${names} | ${names}`, exitCode: 0 };
  return { plain: outcome, compiled: outcome };
}

const ringOfTwo = {
  "hub.mjs": `export * from "./first.mjs";\n`,
  "tail.mjs": `export * from "./second.mjs";\n`,
  "first.mjs": `export * from "./second.mjs";\nexport * from "./more.cjs";\nexport const one = 1;\n`,
  "second.mjs": `export * from "./first.mjs";\nexport const two = 2;\n`,
  "more.cjs": `exports.other = 5;\n`,
};

test("the door that is opened second leads to the far file's CommonJS file too", async () => {
  expect(await bothRuns(ringOfTwo, ["first.mjs", "second.mjs"], ["hub.mjs", "tail.mjs"])).toEqual(
    twice("one=1,other=5,two=2"),
  );
});

test("whichever door is opened first, with a CommonJS file behind each file of the ring", async () => {
  const kit = {
    ...ringOfTwo,
    "second.mjs": `export * from "./first.mjs";\nexport * from "./quart.cjs";\nexport const two = 2;\n`,
    "quart.cjs": `exports.quart = 4;\n`,
  };
  expect(await bothRuns(kit, ["first.mjs", "second.mjs"], ["tail.mjs", "hub.mjs"])).toEqual(
    twice("one=1,other=5,quart=4,two=2"),
  );
  expect(await bothRuns(kit, ["first.mjs", "second.mjs"], ["hub.mjs", "tail.mjs"])).toEqual(
    twice("one=1,other=5,quart=4,two=2"),
  );
});

test("a ring of three", async () => {
  const kit = {
    ...ringOfTwo,
    "second.mjs": `export * from "./third.mjs";\nexport const two = 2;\n`,
    "third.mjs": `export * from "./first.mjs";\nexport const three = 3;\n`,
    "tail.mjs": `export * from "./third.mjs";\n`,
  };
  expect(await bothRuns(kit, ["first.mjs", "second.mjs", "third.mjs"], ["hub.mjs", "tail.mjs"])).toEqual(
    twice("one=1,other=5,three=3,two=2"),
  );
});
