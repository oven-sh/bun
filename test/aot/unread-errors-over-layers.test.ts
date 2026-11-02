import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// An error keeps the return addresses of its stack until somebody reads `stack`. Where a function of one of its frames dies first, the collector writes the stack down
// at the end of a collection. A heap that has been quiet for a while is collected on the collector's own thread while the program waits, and over layers that thread
// has to ask the image that each frame is of: it took the image that the program ran when the collection began.
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "helpers/theirs.js": `// Goes to and fro between this file and the caller's, and allocates nothing.
export function toAndFro(turns, back) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + back(i)) | 0;
  return sum;
}
// Each way goes through a function or an object that dies at once, so the collector writes the error's stack down at the end of its next collection.
export const theirWays = {
  text(tag) {
    let made;
    new Function("f", "f()")(function theirsFromText() {
      made = new Error("theirs text " + tag);
    });
    return made;
  },
  sort(tag) {
    let made;
    [1, 2].sort(function theirsFromSort() {
      made ??= new Error("theirs sort " + tag);
      return 0;
    });
    return made;
  },
  proxy(tag) {
    let made;
    new Proxy(function theirsBehindProxy() {
      made = new Error("theirs proxy " + tag);
    }, {})();
    return made;
  },
};
`,
  "a.test.js": `import { expect, test } from "bun:test";
import { theirWays, toAndFro } from "./helpers/theirs.js";

const myWays = {
  text(tag) {
    let made;
    new Function("f", "f()")(function mineFromText() {
      made = new Error("mine text " + tag);
    });
    return made;
  },
  sort(tag) {
    let made;
    [1, 2].sort(function mineFromSort() {
      made ??= new Error("mine sort " + tag);
      return 0;
    });
    return made;
  },
  proxy(tag) {
    let made;
    new Proxy(function mineBehindProxy() {
      made = new Error("mine proxy " + tag);
    }, {})();
    return made;
  },
};
function back(i) {
  return i & 3;
}

test("errors that nobody has read keep their frames through a collection that ends on the collector's thread", async () => {
  const errors = [];
  for (let round = 0; round < 100; round++) {
    for (const way of Object.keys(myWays)) errors.push(myWays[way](round), theirWays[way](round));
  }
  // A heap that has been quiet for a while is collected while the program waits, on the collector's own thread.
  // That collection ends while the program runs again, in one file or the other.
  const end = performance.now() + 3500;
  while (performance.now() < end) {
    await new Promise(resolve => setTimeout(resolve, 1));
    toAndFro(20000, back);
  }
  const shapes = new Map();
  for (const error of errors) {
    const names = error.stack.split("\\n").slice(1, 6).map(line => line.trim().replace(/ ?\\(.*$/, "").replace(/^at (\\/|file:|[A-Za-z]:\\\\).*/, "at a file"));
    const shape = error.message.split(" ").slice(0, 2).join(" ") + ": " + names.join(" < ");
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  for (const shape of [...shapes.keys()].sort()) console.log("SEEN " + shapes.get(shape) + " | " + shape);
  expect(errors.length).toBe(600);
});
`,
  "b.test.js": `import { expect, test } from "bun:test";\ntest("another file, so that the run has pieces", () => expect(1).toBe(1));\n`,
};

async function seenIn(directory: string, words: string | undefined, ...flags: string[]) {
  // The first collection of a quiet heap comes after ten seconds otherwise.
  const env = { ...bunEnv, BUN_IDLE_GC_SECONDS: "1,1,1", ...(words ? { BUN_DEBUG_TEST_AOT_WORDS: words } : {}) };
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", "--timeout=60000", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("the stack of an unread error is written down by the collector's thread, over layers", async () => {
  using dir = tempDir("aot-unread-errors-over-layers", files);
  const plain = await seenIn(String(dir), undefined);
  expect(plain).toEqual({
    seen: [
      "SEEN 100 | mine proxy: at mineBehindProxy < at unknown < at proxy < at <anonymous>",
      "SEEN 100 | mine sort: at mineFromSort < at sort < at sort < at <anonymous>",
      "SEEN 100 | mine text: at mineFromText < at anonymous < at text < at <anonymous>",
      "SEEN 100 | theirs proxy: at theirsBehindProxy < at unknown < at proxy < at <anonymous>",
      "SEEN 100 | theirs sort: at theirsFromSort < at sort < at sort < at <anonymous>",
      "SEEN 100 | theirs text: at theirsFromText < at anonymous < at text < at <anonymous>",
    ],
    exitCode: 0,
  });
  expect(await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
}, 180_000);
