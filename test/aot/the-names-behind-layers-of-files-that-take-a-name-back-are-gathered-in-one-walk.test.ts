// wide.mjs holds stars over two files. Each of them takes `round` back from wide.mjs by a statement and holds stars over the two files of the next layer, which do the same, 32 layers deep.
// The last layer leads to the file that has the name, and so does a star of wide.mjs that passes none of them.
// Whoever gathers the names behind the stars of wide.mjs has to pass `round` by below every one of those files and find it on the last road. A walk that forgets what it has seen
// whenever such a file leaves the path goes over every simple path: twice the work for each layer, 4 seconds at 16 layers, and no end at 32.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { testOneByOne as test } from "./supported";

raiseDefaultTimeout(120_000);

const layers = 32;

function writeLayers(stars: string[]) {
  const files: Record<string, string> = {
    "package.json": `{ "name": "made-up", "type": "module" }`,
    "wide.mjs": ["./a1.mjs", "./b1.mjs", ...stars].map(path => `export * from "${path}";`).join("\n"),
    "mid.mjs": `export * from "./deep.cjs";`,
    "deep.cjs": `exports.round = "deep";\nexports.only = "only";`,
    "reader.mjs": `import * as barrel from "./wide.mjs";\nexport const look = () => barrel.round + " " + barrel.only;`,
  };
  for (let layer = 1; layer <= layers; layer++) {
    const below = layer < layers ? [`./a${layer + 1}.mjs`, `./b${layer + 1}.mjs`] : ["./mid.mjs"];
    const text = [`export { round } from "./wide.mjs";`, ...below.map(path => `export * from "${path}";`)].join("\n");
    files[`a${layer}.mjs`] = text;
    files[`b${layer}.mjs`] = text;
  }
  return files;
}

test("in a test run under a mock", async () => {
  using dir = tempDir("layers-of-files-that-take-a-name-back", {
    ...writeLayers(["./mid.mjs", "./shapes.mjs"]),
    "shapes.mjs": `export const round = 1, square = 2;`,
    "a.test.js": `import { test, vi } from "bun:test";
test("who has the name", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  console.log("SAID", (await import("./reader.mjs")).look());
});`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "./a.test.js"], String(dir), bunEnv);
  expect({
    said: stdout.split("\n").filter(line => line.startsWith("SAID")),
    stderr: exitCode ? stderr : "",
    exitCode,
  }).toEqual({
    said: ["SAID deep only"],
    stderr: "",
    exitCode: 0,
  });
});

test("in an executable, where two CommonJS files stand behind the stars", async () => {
  using dir = tempDir("layers-of-files-that-take-a-name-back", {
    ...writeLayers(["./mid.mjs", "./third.cjs"]),
    "third.cjs": `exports.other = 1;`,
    "main.mjs": `console.log("SAID", (await import("./reader.mjs")).look());`,
  });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "made"],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { stdout, stderr, exitCode } = await run([join(String(dir), "made")], String(dir), bunEnv);
  expect({ said: stdout.trim(), stderr: exitCode ? stderr : "", exitCode }).toEqual({
    said: "SAID deep only",
    stderr: "",
    exitCode: 0,
  });
});

// The three tests below hold two sizes of one program against each other, by the time the processor spent and not by the clock: a time limit does not see a square.
// Each name that was passed by while hidden is looked for on its own. A search that does, at some file, work that grows with all the names there makes the whole grow with the square:
// four times the names then cost many times the work, where they should cost about twice (the run has a cost of its own that does not grow).
function spend(files: Record<string, string>, said: string) {
  using dir = tempDir("names-that-one-file-takes-back", {
    "package.json": `{ "name": "made-up", "type": "module" }`,
    ...files,
  });
  const ran = Bun.spawnSync({
    cmd: [bunExe(), "test", "--aot", "./a.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines = ran.stdout
    .toString()
    .split("\n")
    .filter(line => line.startsWith("SAID"));
  expect({ said: lines, stderr: ran.exitCode ? ran.stderr.toString() : "", exitCode: ran.exitCode }).toEqual({
    said: [said],
    stderr: "",
    exitCode: 0,
  });
  return Number(ran.resourceUsage.cpuTime.user);
}
const namesOf = (letter: string, count: number) => Array.from({ length: count }, (_, index) => `${letter}${index}`);
const stars = (...paths: string[]) => paths.map(path => `export * from "${path}";`).join("\n");
const fills = (letter: string, count: number) =>
  `for (let index = 0; index < ${count}; index++) exports["${letter}" + index] = index;`;

// One file takes many names back and leads straight to the file that has them; a second road comes to that file over sixteen files.
test("four times the names that one file takes back do not cost ten times the work", () => {
  const program = (count: number) => {
    const links = 16;
    const files: Record<string, string> = {
      "wide.mjs": stars("./taker.mjs", "./c1.mjs", "./shapes.mjs"),
      "taker.mjs": `export { ${namesOf("n", count).join(", ")} } from "./wide.mjs";\nexport * from "./deep.cjs";`,
      "deep.cjs": namesOf("n", count)
        .map((name, index) => `exports.${name} = ${index};`)
        .join("\n"),
      "shapes.mjs": `export const square = 2;`,
      "reader.mjs": `import * as barrel from "./wide.mjs";\nexport const look = () => [barrel.n7, barrel.n${count - 1}, Object.keys(barrel).length].join(" ");`,
      "a.test.js": `import { test, vi } from "bun:test";
test("who has the names", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 10 }));
  console.log("SAID", (await import("./reader.mjs")).look());
});`,
    };
    for (let link = 1; link <= links; link++)
      files[`c${link}.mjs`] = stars(link < links ? `./c${link + 1}.mjs` : "./deep.cjs");
    return spend(files, `SAID 7 ${count - 1} ${count + 1}`);
  };
  expect(program(16000) / program(4000)).toBeLessThan(5);
});

// Every search passes a second file on its way. What stands there has as many names as are searched for.
const besideAFileWithAsManyNames = (count: number, files: Record<string, string>) => ({
  "wide.mjs": stars("./taker.mjs", "./holder.mjs", "./beside.mjs"),
  "taker.mjs": `export { ${namesOf("n", count).join(", ")} } from "./wide.mjs";\nexport * from "./below.mjs";`,
  "below.mjs": stars("./deep.cjs"),
  "beside.mjs": stars("./below.mjs"),
  "holder.mjs": stars("./part.mjs"),
  "part.mjs": stars("./big.cjs"),
  "deep.cjs": fills("n", count),
  "big.cjs": fills("b", count),
  ...files,
});

test("nor beside a mock whose factory takes the original", () => {
  const program = (count: number) =>
    spend(
      besideAFileWithAsManyNames(count, {
        "a.test.js": `import { test, vi } from "bun:test";
test("who has the names", async () => {
  vi.doMock("./part.mjs", async original => { await original(); return { extra: 1 }; });
  const all = await import("./wide.mjs");
  console.log("SAID", all.n0, all.n${count - 1}, all.b0, "b0" in all, Object.keys(all).length);
});`,
      }),
      `SAID 0 ${count - 1} undefined true ${count * 2}`,
    );
  expect(program(3200) / program(800)).toBeLessThan(3);
});

test("nor beside a file that is seen as a mock that has ended", () => {
  const program = (count: number) =>
    spend(
      besideAFileWithAsManyNames(count, {
        "bunfig.toml": `[test]\npreload = ["./preload.js"]`,
        "preload.js": `import { vi } from "bun:test";
vi.doMock("./part.mjs", () => Object.fromEntries(Array.from({ length: ${count} }, (_, index) => ["m" + index, index])));
await import("./holder.mjs");
vi.doUnmock("./part.mjs");`,
        "a.test.js": `import { test } from "bun:test";
test("who has the names", async () => {
  const all = await import("./wide.mjs");
  console.log("SAID", all.n0, all.n${count - 1}, all.m${count - 1}, Object.keys(all).length);
});`,
      }),
      `SAID 0 ${count - 1} ${count - 1} ${count * 2}`,
    );
  expect(program(12800) / program(3200)).toBeLessThan(2.2);
});
