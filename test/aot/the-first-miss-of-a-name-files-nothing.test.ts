import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const count = 40;
const namesOf = (prefix: string) => Array.from({ length: count }, (_, index) => prefix + index);
const textOf = (prefix: string) =>
  JSON.stringify(JSON.stringify(Object.fromEntries(namesOf(prefix).map((name, index) => [name, index]))));
const files = {
  "main.js": `
    const parse = text => JSON.parse(process.argv.length > 90 ? "{}" : text);
    const read = ${textOf("read")}, stored = ${textOf("stored")}, asked = ${textOf("asked")};
    const kept = [parse(read), parse(stored), parse(asked)];
    function readAll(box) {
      return ${namesOf("read")
        .map(name => `box.${name}`)
        .join(" + ")};
    }
    function storeAll(box, value) {
      ${namesOf("stored")
        .map(name => `box.${name} = value;`)
        .join(" ")}
      return box.stored0;
    }
    function askAll(box) {
      return ${namesOf("asked")
        .map(name => `("${name}" in box ? 1 : 0)`)
        .join(" + ")};
    }
    const rounds = Number(process.argv[2]);
    let sum = 0;
    for (let round = 0; round < rounds; round++) sum += readAll(parse(read)) + storeAll(parse(stored), 1) + askAll(parse(asked));
    console.log(sum, kept.length);
  `,
};

const filing = ["operationAOTGetByIdAndCache", "operationAOTPutByIdAndCache", "operationAOTInByIdAndCache"];

test("a pair of shape and name is not filed at its first miss; once it has come back a few times it is, and then asks no more", async () => {
  using dir = tempDir("aot-the-first-miss-of-a-name-files-nothing", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: 821 * rounds + " 3\n",
      stderr: "",
      exitCode: 0,
    });
    let asked = 0;
    let notFiled = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\t");
      if (name?.startsWith("operation:") && filing.includes(name.slice("operation:".length))) asked += Number(count);
      if (name === "counter:FirstMissesNotFiled") notFiled += Number(count);
    }
    return { asked, notFiled };
  };
  const none = await counted(0);
  const once = await counted(1);
  const twice = await counted(2);
  const fewTimes = await counted(16);
  const often = await counted(60);
  // An access that is in no table is answered by the objects themselves, and only every sixteenth one of a pair asks the operation, which files it then.
  expect({ askedOnce: once.asked - none.asked, askedTwice: twice.asked - none.asked }).toEqual({
    askedOnce: 0,
    askedTwice: 0,
  });
  expect({
    filed: often.asked - none.asked >= 3 * count,
    notFiledAgain: often.notFiled - fewTimes.notFiled < count,
    level: often.asked - fewTimes.asked < count,
  }).toEqual({
    filed: true,
    notFiledAgain: true,
    level: true,
  });
}, 240_000);
