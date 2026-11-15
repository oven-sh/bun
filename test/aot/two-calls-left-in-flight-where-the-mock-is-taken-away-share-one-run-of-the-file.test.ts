import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Nobody awaits the two calls, and `bun test` ends the run when the tests have ended: once in ten or twenty runs the second call has not answered by then, and its line is missing.
// A compiled run says every line each time. There is one entry under the key of the file: its body runs once, and both calls get what it made, or fail with its error.
const above = `import { opening } from "./part.mjs";\nexport const roof = "above " + opening;\n`;
const told = `error => error.constructor.name + " " + error.message.replace(/"[^"]*[\\\\/]/, '"')`;
const cell = `import { afterEach, test, vi } from "bun:test";
const told = ${told};
test("two calls are left in flight", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(it => console.log("the call came:", it.opening, it.mocked), error => console.log("the call failed:", told(error)));
  import("./above.mjs").then(it => console.log("the call for the file above came:", it.roof), error => console.log("the call for the file above failed:", told(error)));
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
`;
const unsupported = `TypeError require() async module "between.mjs" is unsupported. use "await import()" instead.`;
const forms = {
  "the body of the file runs once": {
    files: { "part.mjs": `console.log("the body of the file runs");\nexport const opening = "its own";\n` },
    lines: [
      "the test ends",
      "the body of the file runs",
      "the call came: its own undefined",
      "the call for the file above came: above its own",
    ],
  },
  "both share the failure of the file": {
    files: {
      "part.mjs": `console.log("the body of the file begins");\nconst { middle } = require("./between.mjs");\nconsole.log("the body of the file ends:", middle);\nexport const opening = "opening " + middle;\n`,
      "between.mjs": `console.log("the file between begins");\nconst { depth } = await import("./below.mjs");\nexport const middle = "between " + depth;\n`,
      "below.mjs": `console.log("the file below runs");\nexport const depth = "its own";\n`,
    },
    lines: [
      "the test ends",
      "the body of the file begins",
      "the file between begins",
      "the file below runs",
      `the call failed: ${unsupported}`,
      `the call for the file above failed: ${unsupported}`,
    ],
  },
};

for (const [form, { files, lines }] of Object.entries(forms)) {
  test.concurrent(`the mock is taken away and a file above is in flight too: ${form}`, async () => {
    using dir = tempDir("aot-two-calls-left-in-flight", {
      "package.json": `{ "name": "made-up", "private": true, "type": "module" }`,
      "above.mjs": above,
      "cell.test.mjs": cell,
      ...files,
    });
    const { stdout, exitCode } = await run([bunExe(), "test", "--aot", "./cell.test.mjs"], String(dir), bunEnv);
    expect({ lines: stdout.split("\n").filter(line => line.startsWith("the ")), exitCode }).toEqual({
      lines,
      exitCode: 0,
    });
  });
}
