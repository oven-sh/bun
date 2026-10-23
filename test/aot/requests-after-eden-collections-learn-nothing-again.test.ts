import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const rounds = 30;

const files = {
  "main.mjs": `
    import http from "node:http";
    import { edenGC, fullGC } from "bun:jsc";

    const collect = { none() {}, eden: edenGC, full: fullGC }[process.argv[2]];
    const server = http.createServer((request, response) => {
      for (const name of ["first", "second", "third"]) {
        const bag = Object.create(null);
        bag[name + request.url.length] = 1;
        bag.other = 2;
        if (bag.other !== 2) throw new Error("the member is gone");
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("hello");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + server.address().port + "/";
    async function get(count) {
      let length = 0;
      for (let i = 0; i < count; i++) length += (await (await fetch(url)).text()).length;
      return length;
    }
    let total = await get(60);
    edenGC();
    total += await get(20);
    for (let round = 0; round < ${rounds}; round++) {
      collect();
      total += await get(4);
    }
    console.log(total);
    process.exit(0);
  `,
};

const learned = [
  "counter:CompiledStructuresMade",
  "operation:operationAOTPutByIdAndCache",
  "operation:operationAOTGetByIdAndCache",
  "operation:operationAOTFillSiteCache",
];

// What a full collection does cost: the ordinary Structures that no object has end, and what the tables held about them is filed again.
const filedAgain = "counter:PairsFiledAgain";

test("a request after an Eden collection makes no Structure and fills no property cache again", async () => {
  using dir = tempDir("aot-requests-after-eden-collections", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode, built.stderr).toBe(0);
  const counted = async (collections: "none" | "eden" | "full") => {
    const path = join(String(dir), "counts-" + collections);
    const env = { ...bunEnv, BUN_JSC_aotCountsPath: path };
    const total = (60 + 20 + rounds * 4) * "hello".length;
    expect(await run([executable, collections], String(dir), env)).toEqual({
      stdout: total + "\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries([...learned, filedAgain].map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\t");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const none = await counted("none");
  const eden = await counted("eden");
  const full = await counted("full");
  expect(none["counter:CompiledStructuresMade"]).toBeGreaterThan(0);
  // The Structures of compiled objects outlast a full collection too. The tables do not wholly: the counts do tell.
  expect(full["counter:CompiledStructuresMade"]).toBe(none["counter:CompiledStructuresMade"]!);
  expect(full[filedAgain]! - none[filedAgain]!).toBeGreaterThan(rounds);
  expect(eden[filedAgain]).toBe(none[filedAgain]!);
  const perRound = (name: string) => Math.round((eden[name]! - none[name]!) / rounds) + 0;
  expect(Object.fromEntries(learned.map(name => [name, perRound(name)]))).toEqual(
    Object.fromEntries(learned.map(name => [name, 0])),
  );
  expect(eden["counter:CompiledStructuresMade"]).toBe(none["counter:CompiledStructuresMade"]!);
}, 240_000);
