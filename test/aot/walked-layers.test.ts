// A walk over a table hands out its names as texts, also the names that are written as numbers, and the function keeps the name in a member that holds a text.
// Under --aot-memory-limit=1KB a test run is compiled as several programs, and the module with the walk lies in a layer below the test files.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const app = (table: string) => `const STATUS = ${table};
function makeReply() { return { code: "none", calls: 0, total: 0, largest: 0, smallest: 0, odd: 0, even: 0 }; }
function classify(reply, text, weight) {
  reply.calls += 1; reply.total += weight; if (reply.total > 100) reply.total -= 100;
  if (weight > reply.largest) reply.largest = weight; if (weight < reply.smallest || reply.calls === 1) reply.smallest = weight;
  if (weight % 2 === 1) reply.odd += 1; else reply.even += 1; if (reply.odd > reply.even + 10) reply.odd = reply.even;
  if (reply.largest - reply.smallest > 50) reply.largest = reply.smallest + 50;
  for (const code in STATUS) { if (STATUS[code] === text) reply.code = code; }
  return reply.calls; }
function codeOf(reply) { return reply.code; }
export function run() { const reply = makeReply(); classify(reply, "Not Found", 1); const first = codeOf(reply); classify(reply, "OK", 2); return first + ";" + codeOf(reply); }
`;
const file = (name: string, answer: string) =>
  `import { test, expect } from "bun:test";\nimport { run } from "../src/app.js";\n` +
  `test("${name}", () => { const r = run(); console.log("R=${name}:" + r); expect(r).toBe("${answer}"); });\n`;

async function answers(table: string, answer: string, flags: string[]) {
  using dir = tempDir("aot-walked-layers", {
    "package.json": `{"name":"proj","type":"module"}`,
    "src/app.js": app(table),
    "cases/t1.test.js": file("t1", answer),
    "cases/t2.test.js": file("t2", answer),
    "cases/t3.test.js": file("t3", answer),
  });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--parallel=2", "./cases"],
    String(dir),
    bunEnv,
  );
  const printed = [...(stdout + stderr).matchAll(/R=t\d:\S+/g)].map(match => match[0]).sort();
  return { printed, stopped: /^AOT: .*$/m.exec(stderr)?.[0], exitCode };
}

const tables = {
  "names written as numbers": [`{ 200: "OK", 404: "Not Found", 500: "Server Error" }`, "404;200"],
  "names written as words": [`{ ok: "OK", missing: "Not Found", broken: "Server Error" }`, "missing;ok"],
};
for (const [name, [table, answer]] of Object.entries(tables)) {
  test(
    name,
    async () => {
      const [plain, compiled, layered] = await Promise.all([
        answers(table, answer, []),
        answers(table, answer, ["--aot"]),
        answers(table, answer, ["--aot", "--aot-memory-limit=1KB"]),
      ]);
      expect(plain).toEqual({
        printed: ["t1", "t2", "t3"].map(t => `R=${t}:${answer}`),
        stopped: undefined,
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
      expect(layered).toEqual(plain);
    },
    120_000,
  );
}
