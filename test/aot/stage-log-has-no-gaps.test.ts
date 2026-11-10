// The lines of the stage log add up to the time of the process. What no stage covers has a line of its own: Bun's start and the script that asks for the build,
// what sets the build up, the way into the engine, what follows it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { buildEnvironment, compileCommand, withThreads } from "./harness/flags";
import { test } from "./supported";

const stagesOfFrontEnd = ["Load", "BindModules", "Check", "Lower", "LinkAndEmit"].map(stage => `front end | ${stage}`);
// Between `the payload` and `the file`. Which of them there are depends on the format of the executable.
const partsOfSomeWriters = ["name of the executable", "copy of the template", "the template", "addresses in the image"];

async function build(env: Record<string, string>) {
  using dir = tempDir("aot-stage-log-has-no-gaps", { "main.ts": `console.log(21 * 2);\n` });
  await using child = Bun.spawn({
    cmd: [bunExe(), ...compileCommand, withThreads(2), "main.ts", "--outfile", "main"],
    cwd: String(dir),
    env: { ...bunEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  expect(exitCode).toBe(0);
  // A label with a colon is a part of another line.
  const lines = stderr.matchAll(
    /^AOT phase times: ((?:front end|ReadAndVerify) \| [^|:]+) \| wall ([0-9.]+) ms(?:.* \| since the process began ([0-9.]+) ms)?/gm,
  );
  return {
    stderr,
    lines: Array.from(lines, ([, label, wall, sinceProcessBegan]) => ({
      label,
      wall: Number(wall),
      sinceProcessBegan: sinceProcessBegan === undefined ? undefined : Number(sinceProcessBegan),
    })),
  };
}

test("what no stage covers has a line, with the stage log and only with it", async () => {
  const { stderr, lines } = await build({ [buildEnvironment.logsPhaseTimes]: "1" });
  const labels = lines.map(line => line.label);
  expect(labels.filter(label => !stagesOfFrontEnd.includes(label))).toEqual([
    "front end | before the build",
    "front end | in front of Load",
    "ReadAndVerify | enter the engine",
    "ReadAndVerify | read",
    "ReadAndVerify | release the bytes of the program",
    "ReadAndVerify | verify records",
    "ReadAndVerify | verify bodies",
    "front end | the engine",
    "front end | behind the engine",
  ]);
  expect(stderr).toContain("AOT phase times: front end | the engine: outside its stages | wall ");
  // What follows the engine is told part by part, and the parts add up to its line.
  const parts = Array.from(
    stderr.matchAll(/^AOT phase times: front end \| behind the engine: ([^|]+) \| wall ([0-9.]+) ms/gm),
    ([, name, wall]) => ({ name, wall: Number(wall) }),
  );
  expect(parts.map(part => part.name).filter(name => !partsOfSomeWriters.includes(name))).toEqual([
    "end of the build",
    "used features, trimming",
    "reports",
    "the payload",
    "the file",
    "metafile",
    "drop the build",
  ]);
  const behindTheEngine = lines.find(line => line.label === "front end | behind the engine")!.wall;
  const sumOfParts = parts.reduce((total, part) => total + part.wall, 0);
  expect(Math.abs(behindTheEngine - sumOfParts)).toBeLessThan(Math.max(50, behindTheEngine * 0.03));
  // The texts of all modules stay in memory while the engine runs.
  expect(stderr).toMatch(/^AOT phase times: front end \| LinkAndEmit: source texts \d+ MB \| wall /m);
  // The stages stand between the two, one behind the other.
  expect(labels[2]).toBe("front end | Load");
  expect(labels[labels.indexOf("ReadAndVerify | enter the engine") - 1]).toBe("front end | LinkAndEmit");
  // The check of the plan runs beside Compile. Its line among the stages is only the wait after the units, so no time is counted twice; the lane's own time is a part.
  const stepsOfEngine = Array.from(
    stderr.matchAll(/^AOT phase times: ((?:PlanSlots|GenerateCode) \| [^|]+) \| wall /gm),
    ([, label]) => label,
  );
  expect(stepsOfEngine).toContain("PlanSlots | check the plan: in its lane");
  const unitsAndWait = ["GenerateCode | compile units", "PlanSlots | check the plan"];
  expect(stepsOfEngine.filter(step => unitsAndWait.includes(step))).toEqual(unitsAndWait);

  // The engine's own lines lie inside `the engine`. Both numbers are the process's own, so the load of the machine cancels out.
  const ofFrontEnd = lines.filter(line => line.label.startsWith("front end | "));
  const sum = ofFrontEnd.reduce((total, line) => total + line.wall, 0);
  const sinceProcessBegan = ofFrontEnd.at(-1)!.sinceProcessBegan!;
  expect(sinceProcessBegan).toBeGreaterThan(0);
  expect(Math.abs(sinceProcessBegan - sum)).toBeLessThan(Math.max(50, sinceProcessBegan * 0.03));

  expect((await build({})).lines).toEqual([]);
}, 120_000);
