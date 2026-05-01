import { spawnSync } from "bun";
import { expect, it } from "bun:test";
import { bunExe } from "harness";

it("process.exit(1) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-1.js"]);
  expect(exitCode).toBe(1);
});

it("await on a thrown value reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-await-throw-1.js"]);
  expect(exitCode).toBe(1);
});

it("unhandled promise rejection reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-unhandled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("handled promise rejection reports exit code 0", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-handled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("process.exit(0) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-0.js"]);
  expect(exitCode).toBe(0);
});
