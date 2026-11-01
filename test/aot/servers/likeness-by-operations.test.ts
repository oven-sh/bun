// ./a-test-run-compiles-what-an-executable-compiles.test.ts holds a test run to the executable by the bytes of each function. Two forms of a run can't be
// held that way, and they are the forms that a large suite runs in:
//
//   --isolate (--parallel implies it): each test file gets a realm, and every test of an object's shape also asks whether the object is of this realm. An
//   object can get from one file to the next (../isolate-doors.test.ts), so that is needed. It changes the bytes of a third of the functions.
//   Layers: a run that is too large for one program is compiled as several, and a layer doesn't see who calls it.
//
// So here a function counts as alike where it has the same bytes or was made of the same operations, each as often: the compiler's map lists them.
// What a program needs to run more than once in a process isn't counted. The share of the executable's functions that are alike is held from below.
//
//   A run in layers ranks its functions as a very large program does, and so does the executable of one. The servers are small, so the layers are
//   held to an executable that is ranked that way.
//   A share that falls: flow has given up something more where a program runs in several realms, or where it doesn't see its callers.
//   A share that rises: raise the number here. It prints one line a server and form that begins with ALIKE.
import { expect } from "bun:test";
import { readdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { afterAll, raiseDefaultTimeout } from "../harness/default-timeout";
import { buildEnvironment, compileCommand } from "../harness/flags";
import { beforeAll, describe, test } from "../supported";
import { operationsOfProgram } from "./functions-of-a-map";
import { copyApp } from "./run-servers";

raiseDefaultTimeout(120_000);

/** Percent of the executable's functions, rounded down, on Linux x64, less one. */
const alikeAtLeast: Record<string, Record<string, number>> = {
  hono: { plain: 98, isolate: 88, layers: 30 },
  // TODO: the executable marks 46 of express's CommonJS files as ones that may run again, for 12; over layers every file may load again. Back to 34 when that mark goes.
  express: { plain: 98, isolate: 90, layers: 25 },
  fastify: { plain: 87, isolate: 79, layers: 32 },
};
/**
 * The same where another test file runs first, as in every project with two. A layer doesn't follow the place of a test file.
 * TODO: one program does, and is owed the number above.
 */
const alikeBehindAnotherFileAtLeast: Record<string, Record<string, number>> = {
  hono: { plain: 95, isolate: 86, layers: 30 }, // owed: 98, 88
  express: { plain: 83, isolate: 76, layers: 25 }, // owed: 98, 90; layers: TODO, as above
  fastify: { plain: 79, isolate: 71, layers: 32 }, // owed: 87, 79
};
const servers = Object.keys(alikeAtLeast);
const forms = ["plain", "isolate", "layers"];
const places = ["", " behind another file"];

describe.skipIf(!isLinux || process.arch !== "x64")(
  "a test run is made of the executable's operations: servers",
  () => {
    const work = String(tempDir("aot-servers-likeness", {}));
    const app = join(work, "app");
    const shares = new Map<string, { alike: number; executable: number }>();
    afterAll(() => rmSync(work, { recursive: true, force: true }));

    beforeAll(async () => {
      await copyApp(app);
      const mapsOf = (name: string) => readdirSync(work).filter(file => file.startsWith(`${name}.map.`)).map(file => join(work, file)); // prettier-ignore
      const withMaps = (name: string, words?: string) => ({
        ...bunEnv,
        PORT: "0",
        [buildEnvironment.mapFilePath]: join(work, `${name}.map.%p`),
        ...(words ? { BUN_DEBUG_TEST_AOT_WORDS: words } : {}),
      });
      const executableOf = (server: string, name: string, flags: string[]) =>
        slot(async () => {
          const executable = join(work, `${name}${isWindows ? ".exe" : ""}`);
          built(await spawned([bunExe(), ...compileCommand, ...flags, "--target=bun", `./${server}.ts`, "--outfile", executable], app, withMaps(name))); // prettier-ignore
          rmSync(executable, { force: true });
          return operationsOfProgram(mapsOf(name));
        });
      const testRunOf = (server: string, name: string, flags: string[], words?: string, ahead: string[] = []) =>
        slot(async () => {
          await spawned([bunExe(), "test", "--aot", ...flags, ...ahead, `./${server}.test.ts`], app, withMaps(name, words)); // prettier-ignore
          return operationsOfProgram(mapsOf(name));
        });
      writeFileSync(join(app, "0-first.test.ts"), `import { test } from "bun:test";\ntest("first", () => {});\n`);
      for (const server of servers) {
        // The server listens from then on, so the one test ends the process.
        writeFileSync(
          join(app, `${server}.test.ts`),
          `import { test } from "bun:test";\nimport "./${server}.ts";\ntest("is loaded", () => process.exit(0));\n`,
        );
      }
      await Promise.all(
        servers.map(async server => {
          const first = ["./0-first.test.ts"];
          const [executable, rankedAsLayers, plain, isolate, layers, plainBehind, isolateBehind, layersBehind] = await Promise.all([
            executableOf(server, `${server}-executable`, []),
            executableOf(server, `${server}-ranked`, ["--aot-heat=read-off-structure"]),
            testRunOf(server, `${server}-plain`, []),
            testRunOf(server, `${server}-isolate`, ["--isolate"]),
            testRunOf(server, `${server}-layers`, [], "TestRunLayers:2"),
            testRunOf(server, `${server}-behind-plain`, [], undefined, first),
            testRunOf(server, `${server}-behind-isolate`, ["--isolate"], undefined, first),
            testRunOf(server, `${server}-behind-layers`, [], "TestRunLayers:2", first),
          ]); // prettier-ignore
          const runs = {
            plain: [executable, plain],
            isolate: [executable, isolate],
            layers: [rankedAsLayers, layers],
            "plain behind another file": [executable, plainBehind],
            "isolate behind another file": [executable, isolateBehind],
            "layers behind another file": [rankedAsLayers, layersBehind],
          };
          for (const [form, [ofExecutable, ofRun]] of Object.entries(runs)) {
            const isAlike = ([key, it]: [string, { bytes: string; operations: string }]) => {
              const other = ofRun.get(key);
              return other !== undefined && (other.bytes === it.bytes || other.operations === it.operations);
            };
            shares.set(`${server} ${form}`, { alike: [...ofExecutable].filter(isAlike).length, executable: ofExecutable.size }); // prettier-ignore
          }
        }),
      );
    }, 900_000);

    const cases = servers.flatMap(server => places.flatMap(place => forms.map(form => [server, form, place])));
    test.each(cases)("%s, %s%s", (server, form, place) => {
      const { alike, executable } = shares.get(`${server} ${form}${place}`)!;
      const percent = Math.floor((100 * alike) / executable);
      console.log(
        `ALIKE ${server} ${form}${place}: ${percent}% (${alike} of the executable's ${executable} functions)`,
      );
      expect(executable).toBeGreaterThan(500);
      const atLeast = (place ? alikeBehindAnotherFileAtLeast : alikeAtLeast)[server][form];
      expect({ server, form, percent: Math.min(percent, atLeast) }).toEqual({ server, form, percent: atLeast });
    });
  },
);
