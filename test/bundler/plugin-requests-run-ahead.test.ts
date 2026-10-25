import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

// Each text takes the plugins' thread for a while after its first `await`. A request that arrives meanwhile doesn't wait
// for all of them.
test("onResolve runs ahead of what other plugins have queued", async () => {
  const textCount = 60;
  const files: Record<string, string> = {
    "entry.ts": [
      `import late from "./late";`,
      ...Array.from({ length: textCount }, (_, index) => `import text${index} from "./text${index}.txt";`),
      `console.log(late, ${Array.from({ length: textCount }, (_, index) => `text${index}`).join(", ")});`,
    ].join("\n"),
    // Large, so that the bundler asks for "virtual:late" when the texts are already queued.
    "late.ts": [
      ...Array.from({ length: 30_000 }, (_, index) => `const unused${index} = ${index};`),
      `export { default } from "virtual:late";`,
    ].join("\n"),
  };
  for (let index = 0; index < textCount; index++) {
    files[`text${index}.txt`] = `text ${index}`;
  }
  using dir = tempDir("plugin-requests-run-ahead", files);

  let textsDone = 0;
  let textsDoneAtResolve = -1;
  const result = await Bun.build({
    entrypoints: [join(String(dir), "entry.ts")],
    plugins: [
      {
        name: "slow texts",
        setup(build) {
          build.onLoad({ filter: /\.txt$/ }, async args => {
            const text = await Bun.file(args.path).text();
            const end = performance.now() + 10;
            while (performance.now() < end) {}
            textsDone++;
            return { contents: `export default ${JSON.stringify(text)};`, loader: "js" };
          });
        },
      },
      {
        name: "virtual module",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            textsDoneAtResolve = textsDone;
            return { path: args.path, namespace: "virtual" };
          });
          build.onLoad({ filter: /./, namespace: "virtual" }, () => ({
            contents: `export default "late";`,
            loader: "js",
          }));
        },
      },
    ],
  });
  expect(result.success).toBe(true);
  expect(textsDone).toBe(textCount);
  expect(textsDoneAtResolve).toBeGreaterThanOrEqual(0);
  expect(textsDoneAtResolve).toBeLessThan(textCount);
});

test("a chain of plugin requests lets setImmediate callbacks run", async () => {
  // Every module imports the next one, and each import goes to the plugin and back.
  const chainLength = 100;
  using dir = tempDir("plugin-requests-chain", { "entry.js": `import "chain:0";` });

  let requestsInARow = 0;
  let mostRequestsInARow = 0;
  const countRequest = () => {
    mostRequestsInARow = Math.max(mostRequestsInARow, ++requestsInARow);
    // Keeps this thread busy once the answer is on its way: the next request is there before this thread looks for it.
    queueMicrotask(() => {
      const end = performance.now() + 1;
      while (performance.now() < end);
    });
  };
  let building = true;
  (function onImmediate() {
    requestsInARow = 0;
    if (building) setImmediate(onImmediate);
  })();

  const result = await Bun.build({
    entrypoints: [join(String(dir), "entry.js")],
    plugins: [
      {
        name: "chain",
        setup(build) {
          build.onResolve({ filter: /^chain:/ }, args => {
            countRequest();
            return { path: args.path.slice("chain:".length), namespace: "chain" };
          });
          build.onLoad({ filter: /.*/, namespace: "chain" }, args => {
            countRequest();
            const next = Number(args.path) + 1;
            return { loader: "js", contents: next < chainLength ? `import "chain:${next}";` : "" };
          });
        },
      },
    ],
  });
  building = false;

  expect(result.success).toBe(true);
  expect(mostRequestsInARow).toBeLessThanOrEqual(16);
});
