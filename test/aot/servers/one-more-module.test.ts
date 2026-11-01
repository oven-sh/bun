// A server gets one more module that nothing uses: one function that is never called. Every function that was there before is compiled to as many bytes as before.
// What a function is compiled to may follow the whole program: which objects there are, how often they are made, what reaches a call. A function that is never called
// adds to none of that.
// The server on Express is not there yet. The name of its case says how many functions move, as read on Linux x64.
import { expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { afterAll } from "../harness/default-timeout";
import { compileCommand } from "../harness/flags";
import { beforeAll, describe, test } from "../supported";
import { copyApp } from "./run-servers";

// Fourteen builds of servers: too long for a build of Bun that checks itself. Elsewhere nobody has read what moves.
const isWhereItWasRead = isLinux && process.arch === "x64" && !isMusl && !isASAN && !isDebug;
const servers = ["thin", "bun", "hono", "node", "elysia", "fastify"];
const notYet = { express: 20 };

/** `name form file position` of each function, and how long each of its versions is. */
function sizesOf(map: string) {
  const sizes = new Map<string, number[]>();
  for (const row of readFileSync(map, "latin1").split("\n")) {
    const columns = row.split("\t");
    if (columns[0] !== "F") continue;
    const key = `${columns[7]} ${columns[8]} ${columns[10]} ${columns[11]}`;
    sizes.set(
      key,
      [...(sizes.get(key) ?? []), Number(columns[3])].sort((a, b) => a - b),
    );
  }
  return sizes;
}

describe.skipIf(!isWhereItWasRead)("one more module", () => {
  const work = String(tempDir("aot-one-more-module", {}));
  const app = join(work, "app");
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  beforeAll(async () => {
    await copyApp(app);
    writeFileSync(join(app, "never-called.ts"), "export function neverCalled(a: number) {\n  return a + 1;\n}\n");
  }, 900_000);

  async function compare(server: string) {
    const [alone, withOneMore] = await Promise.all(
      [`import "./${server}.ts";\n`, `import "./${server}.ts";\nimport "./never-called.ts";\n`].map((text, more) =>
        slot(async () => {
          const name = `${server}-${more ? "with-one-more" : "alone"}`;
          const [map, executable] = [join(work, `${name}.map`), join(work, name + (isWindows ? ".exe" : ""))];
          writeFileSync(join(app, `${name}.ts`), text);
          built(
            await spawned(
              [bunExe(), ...compileCommand, "--define", 'process.env.NODE_ENV="production"', "--target=bun", `./${name}.ts`, "--outfile", executable], // prettier-ignore
              app,
              { ...bunEnv, BUN_JSC_aotMapFilePath: map },
            ),
          );
          rmSync(executable, { force: true });
          return sizesOf(map);
        }),
      ),
    );
    const inBoth = [...alone].filter(([key]) => withOneMore.has(key));
    const moved = inBoth.filter(([key, sizes]) => withOneMore.get(key)!.join() !== sizes.join());
    console.log(`MOVED ${server}: ${moved.length} of ${inBoth.length}`);
    // A map that is read wrongly would compare nothing.
    return { comparesTheProgram: inBoth.length > 1000, moved: moved.map(([key, sizes]) => `${key}: ${sizes} > ${withOneMore.get(key)}`) }; // prettier-ignore
  }

  for (const server of servers)
    test(server, async () => expect(await compare(server)).toEqual({ comparesTheProgram: true, moved: [] }), 600_000);
  for (const [server, count] of Object.entries(notYet))
    test.todo(
      `${server}: ${count} functions move`,
      async () => expect(await compare(server)).toEqual({ comparesTheProgram: true, moved: [] }),
      600_000,
    );
});
