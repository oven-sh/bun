import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// In a test run one source serves every import() of its file that was called in one turn. Such calls settle in their order, however
// many jobs apart they were made, and whether or not a require() has loaded the imports of the file between them.
// Plain `bun test` reads sources on other threads: which of two files comes first is asked of the compiled run alone.
const project = casesOfOneRun(
  "repeated-import-calls-in-a-test-run",
  { "package.json": `{ "name": "p", "type": "module" }` },
  [[[]], [["--aot"]]],
);

const files = {
  "leaf.mjs": `export const v = "leaf";\n`,
  "importer.mjs": `import { w } from "./below.mjs";\nexport const v = "importer" + w;\n`,
  "below.mjs": `export const w = "";\n`,
  "second.mjs": `import { w } from "./below-second.mjs";\nexport const v = "second" + w;\n`,
  "below-second.mjs": `export const w = "";\n`,
  "throws.mjs": `import { w } from "./below.mjs";\nthrow new Error("thrown" + w);\n`,
};

function settle(title: string, printed: string, body: string) {
  const name = project.add(
    name => `import { test } from "bun:test";
${sayOf(name)}
test("${name}", async () => {
  const order = [], calls = [];
  const call = (words, promise) => calls.push(promise.then(module => order.push(words + " " + module.v), error => order.push(words + " " + error.message)));
  ${body}
  await Promise.all(calls);
  say(order.join(", "));
});
`,
    files,
  );
  test(title, async () => {
    expect((await project.ran(["--aot"])).get(name)).toEqual({ result: "pass", printed: printed + "\n" });
    const plain = (await project.ran()).get(name);
    const sorted = (words = "") => words.trim().split(", ").sort();
    expect({ ...plain, printed: sorted(plain?.printed) }).toEqual({ result: "pass", printed: sorted(printed) });
  });
}

settle(
  "a file with imports, called again some jobs later",
  "1 leaf, 2 importer, 4 importer, 3 second, 5 second",
  `call(1, import("./leaf.mjs"));
  await null;
  call(2, import("./importer.mjs"));
  await null;
  call(3, import("./second.mjs"));
  await null;
  call(4, import("./importer.mjs"));
  await null;
  call(5, import("./second.mjs"));`,
);

settle(
  "a file with imports, called three times a job apart",
  "1 leaf, 2 importer, 3 importer, 4 importer",
  `call(1, import("./leaf.mjs"));
  for (let k = 2; k < 5; k++) {
    await null;
    call(k, import("./importer.mjs"));
  }`,
);

settle(
  "a file with imports that throws, called twice a job apart",
  "1 leaf, 2 thrown, 3 thrown",
  `call(1, import("./leaf.mjs"));
  await null;
  call(2, import("./throws.mjs"));
  await null;
  call(3, import("./throws.mjs"));`,
);

settle(
  "a file whose import a require() loads between two calls",
  "1 importer, 2 importer, 3 leaf",
  `call(1, import("./importer.mjs"));
  require("./below.mjs");
  call(2, import("./importer.mjs"));
  call(3, import("./leaf.mjs"));`,
);

settle(
  "files with and without imports in turns, each called twice",
  "2 leaf, 5 leaf, 1 importer, 4 importer, 3 second, 6 second",
  `for (let k = 0; k < 6; k += 3) {
    call(k + 1, import("./importer.mjs"));
    await null;
    call(k + 2, import("./leaf.mjs"));
    await null;
    call(k + 3, import("./second.mjs"));
    await null;
  }`,
);
