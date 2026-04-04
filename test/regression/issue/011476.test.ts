import { expect, test } from "bun:test";
import { tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/11476
// Tree-shaking with multiple entrypoints doesn't work properly.
// When bundling multiple entrypoints that share a common module, the bundler
// includes the union of all used exports from the shared module in every output
// file, instead of only the exports actually used by each specific entrypoint.

test("tree-shaking with multiple entrypoints only includes used exports per chunk", async () => {
  using dir = tempDir("issue-11476", {
    "package.ts": `
export function entrypoint1Function() { console.log("entrypoint1Function called"); }
export function entrypoint2Function() { console.log("entrypoint2Function called"); }
export function unusedByBoth() { console.log("unusedByBoth called"); }
`,
    "entrypoint1.ts": `
import { entrypoint1Function } from "./package";
entrypoint1Function();
`,
    "entrypoint2.ts": `
import { entrypoint2Function } from "./package";
entrypoint2Function();
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entrypoint1.ts`, `${dir}/entrypoint2.ts`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(2);

  const output1 = await result.outputs[0].text();
  const output2 = await result.outputs[1].text();

  // entrypoint1 should only contain entrypoint1Function
  expect(output1).toContain("entrypoint1Function");
  expect(output1).not.toContain("entrypoint2Function");
  expect(output1).not.toContain("unusedByBoth");

  // entrypoint2 should only contain entrypoint2Function
  expect(output2).toContain("entrypoint2Function");
  expect(output2).not.toContain("entrypoint1Function");
  expect(output2).not.toContain("unusedByBoth");
});

test("tree-shaking with multiple entrypoints and overlapping imports", async () => {
  using dir = tempDir("issue-11476-overlap", {
    "shared.ts": `
export function sharedFunc() { console.log("shared"); }
export function onlyInOne() { console.log("onlyInOne"); }
export function onlyInTwo() { console.log("onlyInTwo"); }
export function inBoth() { console.log("inBoth"); }
export function unused() { console.log("unused"); }
`,
    "ep1.ts": `
import { sharedFunc, onlyInOne, inBoth } from "./shared";
sharedFunc();
onlyInOne();
inBoth();
`,
    "ep2.ts": `
import { sharedFunc, onlyInTwo, inBoth } from "./shared";
sharedFunc();
onlyInTwo();
inBoth();
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/ep1.ts`, `${dir}/ep2.ts`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(2);

  const output1 = await result.outputs[0].text();
  const output2 = await result.outputs[1].text();

  // ep1 should have sharedFunc, onlyInOne, and inBoth but NOT onlyInTwo or unused
  expect(output1).toContain("sharedFunc");
  expect(output1).toContain("onlyInOne");
  expect(output1).toContain("inBoth");
  expect(output1).not.toContain("onlyInTwo");
  expect(output1).not.toContain("unused");

  // ep2 should have sharedFunc, onlyInTwo, and inBoth but NOT onlyInOne or unused
  expect(output2).toContain("sharedFunc");
  expect(output2).toContain("onlyInTwo");
  expect(output2).toContain("inBoth");
  expect(output2).not.toContain("onlyInOne");
  expect(output2).not.toContain("unused");
});

test("tree-shaking with 3 entrypoints sharing a module", async () => {
  using dir = tempDir("issue-11476-three", {
    "shared.ts": `
export function funcA() { console.log("A"); }
export function funcB() { console.log("B"); }
export function funcC() { console.log("C"); }
export function unused() { console.log("unused"); }
`,
    "ep1.ts": `
import { funcA } from "./shared";
funcA();
`,
    "ep2.ts": `
import { funcB } from "./shared";
funcB();
`,
    "ep3.ts": `
import { funcA, funcC } from "./shared";
funcA();
funcC();
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/ep1.ts`, `${dir}/ep2.ts`, `${dir}/ep3.ts`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(3);

  const output1 = await result.outputs[0].text();
  const output2 = await result.outputs[1].text();
  const output3 = await result.outputs[2].text();

  // ep1 should only have funcA
  expect(output1).toContain("funcA");
  expect(output1).not.toContain("funcB");
  expect(output1).not.toContain("funcC");
  expect(output1).not.toContain("unused");

  // ep2 should only have funcB
  expect(output2).toContain("funcB");
  expect(output2).not.toContain("funcA");
  expect(output2).not.toContain("funcC");
  expect(output2).not.toContain("unused");

  // ep3 should have funcA and funcC
  expect(output3).toContain("funcA");
  expect(output3).toContain("funcC");
  expect(output3).not.toContain("funcB");
  expect(output3).not.toContain("unused");
});

test("tree-shaking with multiple entrypoints and --minify", async () => {
  using dir = tempDir("issue-11476-minify", {
    "package.ts": `
export function entrypoint1Function() { console.log("entrypoint1Function called"); }
export function entrypoint2Function() { console.log("entrypoint2Function called"); }
`,
    "entrypoint1.ts": `
import { entrypoint1Function } from "./package";
entrypoint1Function();
`,
    "entrypoint2.ts": `
import { entrypoint2Function } from "./package";
entrypoint2Function();
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entrypoint1.ts`, `${dir}/entrypoint2.ts`],
    outdir: `${dir}/dist`,
    minify: true,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(2);

  const output1 = await result.outputs[0].text();
  const output2 = await result.outputs[1].text();

  // Even when minified, entrypoint1 should not contain entrypoint2's string
  expect(output1).toContain("entrypoint1Function called");
  expect(output1).not.toContain("entrypoint2Function called");

  // And vice versa
  expect(output2).toContain("entrypoint2Function called");
  expect(output2).not.toContain("entrypoint1Function called");
});
