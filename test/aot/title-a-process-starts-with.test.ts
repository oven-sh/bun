import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { test } from "./supported";

// On Windows the title of a process is the title of its console. The processes on a console share it and it outlives
// each of them: a process that stores none starts with what the last one has left. Elsewhere each process has its own.
// Either way an executable starts with what `bun run` starts with, and a name imported from node:process holds that,
// whatever is stored later.
const files = {
  "stores-first.mjs": `if (process.argv.length > 3) process.title = process.argv[3];\n`,
  "imports-later.mjs": `export { title } from "node:process";\n`,
  "steps.mjs": `const { commands, steps } = JSON.parse(process.argv[2]);
const results = [];
let left = crypto.randomUUID();
for (const step of steps) {
  const own = step.stores ? [crypto.randomUUID()] : [];
  const { stdout, stderr, exitCode, signalCode } = Bun.spawnSync({
    cmd: [...commands[step.way], left, ...own],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
    killSignal: "SIGKILL",
  });
  results.push({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode, signal: signalCode ?? null, own: own[0] });
  left = own[0] ?? left;
}
console.log(JSON.stringify(results));
`,
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

      // The steps are the only processes on the console of the process that runs them.
      const runner = [bunExe(), "run", "steps.mjs", JSON.stringify({ commands, steps })];
      const { stdout, ...rest } = await spawned(runner, folder, bunEnv, 240_000, true);
      expect(rest).toEqual({ stderr: "", exitCode: 0, signal: null });
      const answers: object[] = JSON.parse(stdout).map((ran: any, index: number) => {
        const { own, stdout, ...rest } = ran;
        expect({ ...steps[index], ...rest }).toEqual({ ...steps[index], stderr: "", exitCode: 0, signal: null });
        return { ...steps[index], ...JSON.parse(stdout) };
      });

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
