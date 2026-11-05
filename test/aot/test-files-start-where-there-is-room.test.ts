import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

type Measured = { milliseconds: number; megabytes?: number; before?: string };

// Each test file says when it starts and ends. The lines come in the order of the events.
const fileOf = (name: string, { milliseconds, before = "" }: Measured) => `
  import { test } from "bun:test";
  import { appendFileSync } from "node:fs";
  test("${name}", async () => {
    appendFileSync(process.env.TRAIL, "start ${name}\\n");
    ${before}
    await Bun.sleep(${milliseconds});
    appendFileSync(process.env.TRAIL, "end ${name}\\n");
  });`;

async function trailOf(records: { [name: string]: Measured }, words: string, ...flags: string[]) {
  const names = Object.keys(records);
  const table = (of: (record: Measured) => number | undefined) =>
    Object.fromEntries(
      names.flatMap(name => (of(records[name]) === undefined ? [] : [[`${name}.test.js`, of(records[name])]])),
    );
  using dir = tempDir("test-files-start-where-there-is-room", {
    ...Object.fromEntries(names.map(name => [`${name}.test.js`, fileOf(name, records[name])])),
    "timings.json": JSON.stringify({
      version: 1,
      files: table(it => it.milliseconds),
      memory: table(it => it.megabytes),
    }),
  });
  const trail = join(String(dir), "trail.txt");
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot", "--isolate", "--timings=timings.json", ...flags, "."],
    String(dir),
    { ...bunEnv, TRAIL: trail, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TEST_PARALLEL_SCALE_MS: "0" },
  );
  expect({ exitCode, passed: stderr.match(/^\s*(\d+) pass$/m)?.[1] }).toEqual({
    exitCode: 0,
    passed: String(names.length),
  });
  return readFileSync(trail, "utf8").trim().split("\n");
}

// The highest sum of `of` over the files that run at one moment.
function mostAtOnce(trail: string[], of: (name: string) => number) {
  let [now, most] = [0, 0];
  for (const line of trail) {
    const [event, name] = line.split(" ");
    most = Math.max(most, (now += event === "start" ? of(name) : -of(name)));
  }
  return most;
}

const forms = [
  ["one program", "TestRunLayers:0"],
  ["two layers", "TestRunLayers:2"],
];

test.each(forms)("what the files that run took never adds up to more than the limit: %s", async (_, words) => {
  const records: { [name: string]: Measured } = { largest: { milliseconds: 300, megabytes: 3000 } };
  // Under a gigabyte each, so without a limit they run beside the largest.
  for (let k = 0; k < 4; k++) records[`large${k}`] = { milliseconds: 250, megabytes: 900 };
  for (let k = 0; k < 10; k++) records[`small${k}`] = { milliseconds: 60, megabytes: 100 };
  const trail = await trailOf(records, words, "--parallel=6", "--aot-memory-limit=4000MB");
  expect(mostAtOnce(trail, name => records[name].megabytes!)).toBeLessThanOrEqual(4000);
  // The heaviest file does not wait for lighter ones, so it is not the end of the run: at most the one that fits beside it, and
  // whose program was built sooner, begins ahead of it. Light files go round the heavy ones that wait.
  const aheadOfLargest = trail.slice(0, trail.indexOf("start largest"));
  expect(aheadOfLargest.filter(line => line.startsWith("start large")).length).toBeLessThanOrEqual(1);
  const untilLargestEnds = trail.slice(0, trail.indexOf("end largest"));
  expect(untilLargestEnds.filter(line => line.startsWith("start small")).length).toBeGreaterThan(0);
});

test("more workers may be asked for than there is room for", async () => {
  const records: { [name: string]: Measured } = {};
  for (let k = 0; k < 12; k++) records[`file${k}`] = { milliseconds: 150, megabytes: 300 };
  const trail = await trailOf(records, "TestRunLayers:2", "--parallel=8", "--aot-memory-limit=1000MB");
  expect(mostAtOnce(trail, () => 1)).toBeWithin(2, 4);
});

test("a file that takes more than the limit runs alone", async () => {
  const records: { [name: string]: Measured } = { huge: { milliseconds: 200, megabytes: 5000 } };
  for (let k = 0; k < 6; k++) records[`small${k}`] = { milliseconds: 80, megabytes: 50 };
  const trail = await trailOf(records, "TestRunLayers:0", "--parallel=4", "--aot-memory-limit=2000MB");
  const at = trail.indexOf("start huge");
  const ahead = trail.slice(0, at);
  expect(ahead.filter(line => line.startsWith("start")).length).toBe(
    ahead.filter(line => line.startsWith("end")).length,
  );
  expect(trail[at + 1]).toBe("end huge");
});

test.skipIf(!isLinux).each(forms)(
  "a file without a record counts as the largest such file that the run has seen: %s",
  async (_, words) => {
    // The quickest file runs first, so that the run learns what a worker holds. Nobody knew that it takes 600 MB.
    const records: { [name: string]: Measured } = {
      surprise: { milliseconds: 1, before: "globalThis.kept = Buffer.alloc(600 << 20, 1);" },
    };
    for (let k = 0; k < 30; k++) records[`unknown${k}`] = { milliseconds: 120 };
    const trail = await trailOf(records, words, "--parallel=6", "--aot-memory-limit=2000MB");
    const afterSurprise = trail.slice(trail.indexOf("end surprise") + 1);
    // The run hears of the 600 MB a moment after the test has ended. Each worker may have got one more file by then.
    const started = afterSurprise.filter(line => line.startsWith("start")).map(line => line.split(" ")[1]);
    const knowing = new Set(started.slice(6));
    expect(knowing.size).toBeGreaterThan(3);
    expect(mostAtOnce(afterSurprise, name => (knowing.has(name) ? 1 : 0))).toBeWithin(1, 4);
  },
);
