// CI prints of a file that passes the time it took and nothing else, so a test that skips itself for want of a tool passes in silence, in
// every lane if it must. This file skips nothing. It asks for everything that a test of this folder may skip itself for
// (harness/capabilities.ts), through the probes that those tests ask, and holds the answers against what-this-lane-can.json, which has a
// line for each lane of CI. A lane that loses what it had fails here, and so does one that gains: the line is then out of date. `null`
// stands where nobody has seen the answer yet: it is asked and said, and nothing is held. What no lane has stands there as `false` in
// every line, in plain sight. Whatever fails in a lane says what the lane can: harness/capabilities.ts.
// Outside CI every probe is asked and nothing is held against a line, unless AOT_LANE names one: a bench may have a line of its own.
// AOT_LANE_UPDATE=1 prints the line of this lane and writes what-this-lane-can.not-yet.txt.
import { expect, test } from "bun:test";
import { isCI } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import "../bundler/compile-trim-features";
import "./analysis-scaling/measure-check";
import "./engine/testaot";
import "./hardened";
import { capabilities, lane, whereTheLineOfThisLaneLies, without, type Capability } from "./harness/capabilities";
import "./harness/registry";
import "./perf/step-idioms";
import "./shell/tools";
import stored from "./what-this-lane-can.json";

test("this lane can what it could", () => {
  const reasons = Object.fromEntries(capabilities.map(capability => [capability, without(capability)]));
  const can = Object.fromEntries(capabilities.map(capability => [capability, reasons[capability] === undefined]));
  if (process.env.AOT_LANE_UPDATE) console.log(JSON.stringify({ [lane]: can }));
  writeFileSync(whereTheLineOfThisLaneLies, JSON.stringify(can));
  if (!isCI && !process.env.AOT_LANE) return;
  const could = (stored as Record<string, Partial<Record<Capability, boolean | null>>>)[lane];
  if (!could) throw new Error(`what-this-lane-can.json has no line for ${lane}. It can: ${JSON.stringify(can)}`);
  const differing = capabilities.filter(
    capability => could[capability] !== null && can[capability] !== could[capability],
  );
  const say = (capability: Capability) =>
    `${capability}: ${reasons[capability] ?? "it is to be had"} (the line says ${could[capability]})`;
  expect({ lane, differing: differing.map(say), line: differing.length ? JSON.stringify(can) : "" }).toEqual({
    lane,
    differing: [],
    line: "",
  });
});

// Words that say where a test runs, which a lane does not lose.
const wordsOfThePlatform =
  /^(?:is(?:Windows|Linux|MacOS|Posix|ASAN|Debug|CI|BuildKite|Musl|Glibc|X64|Arm64|SlowBuild|FreeBSD|Android)|unsupported|process|platform|arch|env|typeof|undefined|true|false|null|without|includes|x64|arm64|linux|darwin|win32|string)$/;
const declaresSkip = /^\s*(?:test|it|describe|testOneByOne)(?:\.\w+)*\.(?:skipIf|if|todoIf)\(([^\n]*)$/gm;

test("a test skips itself for want of a thing only through without()", () => {
  const folder = import.meta.dir;
  const notYet = new Set(
    readFileSync(join(folder, "what-this-lane-can.not-yet.txt"), "utf8").split("\n").filter(Boolean),
  );
  const found = new Set<string>();
  for (const name of readdirSync(folder, { recursive: true, encoding: "utf8" })) {
    if (!/\.ts$/.test(name) || /(?:^|[\\/])(?:node_modules|parallel|programs|runner-suites)[\\/]/.test(name)) continue;
    const text = readFileSync(join(folder, name), "utf8");
    for (const [, condition] of text.matchAll(declaresSkip)) {
      const withoutTexts = condition.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, "");
      const end = withoutTexts.search(/\)\s*(?:\(|\.|$)/);
      const names = (end < 0 ? withoutTexts : withoutTexts.slice(0, end)).match(/[A-Za-z_$][\w$]*/g) ?? [];
      if (names.some(word => !wordsOfThePlatform.test(word)))
        found.add(relative(folder, join(folder, name)).replaceAll("\\", "/"));
    }
  }
  if (process.env.AOT_LANE_UPDATE)
    writeFileSync(join(folder, "what-this-lane-can.not-yet.txt"), [...found].sort().join("\n") + "\n");
  // The list says who skips for want of a thing that no line of the table holds. A file that asks without() by now comes off it.
  const command =
    "AOT_LANE_UPDATE=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 bun test test/aot/what-this-lane-can.test.ts";
  const added = `the condition of a skipIf() here names more than the platform. Best: ask without(<capability>) of harness/capabilities.ts. Else this writes the file's line into what-this-lane-can.not-yet.txt, to land with the test: ${command}`;
  const mended = `asks without() by now. This takes its line out of what-this-lane-can.not-yet.txt: ${command}`;
  expect({
    [added]: [...found].filter(name => !notYet.has(name)).sort(),
    [mended]: [...notYet].filter(name => !found.has(name)).sort(),
  }).toEqual({ [added]: [], [mended]: [] });
});
