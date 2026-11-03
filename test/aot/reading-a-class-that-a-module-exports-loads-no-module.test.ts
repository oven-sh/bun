import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

// The module abort-controller exports the AbortController of the realm.
async function featuresKeptBy(text: string) {
  using dir = tempDir("aot-class-that-a-module-exports", { "main.mjs": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [report] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(report).toContain("aot: trim: the compiler can see every API this program uses");
  return Array.from(report.matchAll(/^aot: trim: kept (.+): used \(/gm), ([, feature]) => feature);
}

const abortController = expect.stringMatching(/^AbortController and AbortSignal/);

test.concurrent.each([
  "typeof AbortController",
  "AbortController.name",
  "AbortController.length",
  "{} instanceof AbortController",
  "Object.create(AbortController.prototype) instanceof AbortController",
  '"abort" in AbortController.prototype',
  "Object.getOwnPropertyNames(AbortController.prototype).length",
  // The module puts them there.
  "typeof AbortController.default",
  "typeof AbortController.AbortController",
  "typeof AbortController.AbortSignal",
])(
  "what a program asks about the class without calling anything keeps nothing: %s",
  async question => {
    expect(await featuresKeptBy(`console.log(${question});\n`)).toEqual([]);
  },
  600_000,
);

test.concurrent.each([
  "new AbortController();",
  'import AbortController from "abort-controller";\nnew AbortController();',
  'import { AbortController as Controller } from "abort-controller";\nnew Controller();',
  'import { AbortSignal as Signal } from "abort-controller";\nSignal.abort();',
  'import * as all from "abort-controller";\nnew all.default();',
  'const Controller = import.meta.require("abort-controller");\nnew Controller();',
  'const { default: Controller } = await import("abort-controller");\nnew Controller();',
  'import "abort-controller";\nnew AbortController.AbortController();',
  'import "abort-controller";\nAbortController.AbortSignal.abort();',
  "AbortController.AbortSignal?.abort();",
  "if (AbortController.default) new AbortController.default();",
  "const { AbortController: Controller } = AbortController;\nif (Controller) new Controller();",
])(
  "a program that makes one keeps the class, however it came by it: %s",
  async program => {
    expect(await featuresKeptBy(program + "\n")).toContainEqual(abortController);
  },
  600_000,
);
