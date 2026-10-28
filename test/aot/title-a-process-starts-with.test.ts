import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { test } from "./supported";

// On Windows the title of a process is the title of its console. The processes on a console share it and it outlives
// each of them: a process that stores none starts with what the last one has left. Elsewhere each process has its own.
// Either way an executable starts with what `bun run` starts with, and a name imported from node:process holds that,
// whatever is stored later.
const files = {
  "stores-first.mjs": `if (process.argv.length > 3) process.title = process.argv[3];\n`,
  "imports-later.mjs": `export { title } from "node:process";\n`,
  "main.mjs": `import "./stores-first.mjs";
import process, { title } from "node:process";
import * as everything from "node:process";
const [left, own] = process.argv.slice(2);
const later = await import("./imports-later.mjs");
const holds = text => (text === own ? "own" : text === left ? "left" : "neither");
console.log(
  JSON.stringify({
    name: holds(title),
    namespace: holds(everything.title),
    later: holds(later.title),
    member: holds(process.title),
    global: holds(globalThis.process.title),
    required: holds(process.getBuiltinModule("node:process").title),
  }),
);
`,
};

const titleOfThisProcess = process.title;
if (isWindows) afterAll(() => void (process.title = titleOfThisProcess));

test(
  "an executable starts with the title that `bun run` starts with",
  () =>
    slot(async () => {
      using dir = tempDir("aot-title-a-process-starts-with", files);
      const folder = String(dir);
      const executable = join(folder, isWindows ? "main.exe" : "main");
      const build = [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable];
      built(await spawned(build, folder, bunEnv));

      const commands = { plain: [bunExe(), "run", "main.mjs"], compiled: [executable] };
      const steps = [
        { way: "plain", stores: true },
        { way: "plain", stores: false },
        { way: "compiled", stores: false },
        { way: "compiled", stores: true },
        { way: "compiled", stores: false },
        { way: "plain", stores: false },
        { way: "plain", stores: true },
      ] as const;

      const answers: object[] = [];
      let left = crypto.randomUUID();
      for (const step of steps) {
        const own = step.stores ? [crypto.randomUUID()] : [];
        const ran = await spawned([...commands[step.way], left, ...own], folder, bunEnv);
        const { stdout, ...rest } = ran;
        expect({ ...step, ...rest }).toEqual({ ...step, stderr: "", exitCode: 0, signal: null });
        answers.push({ ...step, ...JSON.parse(stdout) });
        left = own[0] ?? left;
      }

      const isKept = (answers[1] as { member: string }).member === "left";
      console.error(`TITLE: a process starts with the title that the last one has left: ${isKept}`);
      if (!isWindows) expect(isKept).toBe(false);
      expect(answers).toEqual(
        steps.map((step, index) => {
          const atTheStart = isKept && index > 0 ? "left" : "neither";
          const now = step.stores ? "own" : atTheStart;
          const bound = { name: atTheStart, namespace: atTheStart, later: atTheStart };
          return { ...step, ...bound, member: now, global: now, required: now };
        }),
      );
    }),
  300_000,
);
