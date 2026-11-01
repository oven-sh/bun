// A CommonJS file that may run again (`require()` runs a file again whose last run threw) is compiled otherwise: its variables are stored more than once, its environments stay on the heap.
// One rule that says "may" too readily marks every file of a program: the price is a tenth of the code and most of what flow promotes. So the count is held from above on public programs.
// The same program behind `await import()` at the top of an entry point has the same files marked: a rejection there ends the process as a throw under an import statement does.
// A count that falls: lower the number here. It prints one line a server that begins with MARKED.
import { expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { afterAll, raiseDefaultTimeout } from "../harness/default-timeout";
import { buildEnvironment, compileCommand } from "../harness/flags";
import { beforeAll, describe, test } from "../supported";
import { copyApp } from "./run-servers";

raiseDefaultTimeout(120_000);

// express: 34 of them are what the top loads behind lib/view.js, whose constructor requires a name that nobody knows: a function that the top calls may be the first to load them.
const markedAtMost: Record<string, number> = { express: 46, fastify: 42, koa: 12 };

describe("CommonJS files that may run again: servers", () => {
  const work = String(tempDir("aot-servers-run-again", {}));
  const app = join(work, "app");
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  beforeAll(() => copyApp(app));

  const markedIn = (entry: string) =>
    slot(async () => {
      const executable = join(work, `${entry}${isWindows ? ".exe" : ""}`);
      const build = await spawned([bunExe(), ...compileCommand, "--target=bun", `./${entry}.ts`, "--outfile", executable], app, { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" }); // prettier-ignore
      built(build);
      rmSync(executable, { force: true });
      return Number(/CommonJS files that may run again (\d+)/.exec(build.stderr + build.stdout)?.[1]);
    });

  for (const [server, most] of Object.entries(markedAtMost)) {
    test.concurrent(server, async () => {
      writeFileSync(join(app, `${server}-behind-await.ts`), `await import("./${server}.ts");\n`);
      const [asEntry, behindAwait] = await Promise.all([markedIn(server), markedIn(`${server}-behind-await`)]);
      console.log(`MARKED ${server}: ${asEntry} as the entry point, ${behindAwait} behind await import()`);
      expect(asEntry).toBeLessThanOrEqual(most);
      expect(behindAwait).toBe(asEntry);
    });
  }
});
