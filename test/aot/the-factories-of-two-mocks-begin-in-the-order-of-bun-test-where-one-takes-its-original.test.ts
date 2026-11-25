import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` fetches the whole graph of a load, the original of a mock that takes it among it, and then calls the factories as their modules would be evaluated: the deepest first.
const projectOf = (mockOfGauge: string) => ({
  "package.json": `{ "name": "made-up", "type": "module" }\n`,
  "gauge.cjs": `exports.held = 1;\n`,
  "porch.js": `export * from "./gauge.cjs";\n`,
  "shelf.js": `export * from "./gauge.cjs";\nexport * from "./porch.js";\n`,
  "attic.js": `export * from "./shelf.js";\n`,
  "late.js": `export const late = "file";\n`,
  "reader.js": `import * as all from "./attic.js";\nimport { late } from "./late.js";\nexport const look = () => all.held + " " + late;\n`,
  "a_test.js": `import { test, vi } from "bun:test";
import "./porch.js";
test("each factory says when it begins and ends", async () => {
${mockOfGauge}  vi.doMock("./shelf.js", async original => {
    console.log("SAID shelf begins");
    const real = await original();
    console.log("SAID shelf ends");
    return { ...real };
  });
  vi.doMock("./late.js", async () => {
    console.log("SAID late begins");
    await 0;
    console.log("SAID late ends");
    return { late: "mock" };
  });
  vi.resetModules();
  console.log("SAID", (await import("./reader.js")).look());
});
`,
});

async function linesOf(project: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-the-factories-of-two-mocks", project);
  const { stdout } = await run([bunExe(), "test", ...flags, "./a_test.js"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

test.failing(
  "it prints what bun test prints: a wrong order today: under `bun test --aot` the factory that takes its original begins first",
  async () => {
    const project = projectOf("");
    const plain = await linesOf(project);
    expect(plain).toEqual([
      "SAID late begins",
      "SAID late ends",
      "SAID shelf begins",
      "SAID shelf ends",
      "SAID 1 mock",
    ]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);

test.failing(
  "the file below the original is mocked too: it prints what bun test prints: a wrong order today: under `bun test --aot` its factory is called fourth, where `bun test` calls it first",
  async () => {
    const project = projectOf(`  vi.doMock("./gauge.cjs", () => (console.log("SAID gauge"), { held: 10 }));\n`);
    const plain = await linesOf(project);
    expect(plain).toEqual([
      "SAID gauge",
      "SAID late begins",
      "SAID late ends",
      "SAID shelf begins",
      "SAID shelf ends",
      "SAID 10 mock",
    ]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);
