import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("declare followed by block should error instead of crash", async () => {
  using dir = tempDir("declare-block-test", {
    "test.ts": `declare{}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "1 | declare{}
               ^
    error: Unexpected {
        at <dir>/test.ts:1:8"
  `);
  expect(exitCode).toBe(1);
});

test("declare block followed by arrow function should error", async () => {
  using dir = tempDir("declare-block-arrow", {
    "test.ts": `declare{}_=>_`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "1 | declare{}_=>_
               ^
    error: Unexpected {
        at <dir>/test.ts:1:8"
  `);
  expect(exitCode).toBe(1);
});

test("declare empty block followed by arrow function should error", async () => {
  using dir = tempDir("declare-empty-block-arrow", {
    "test.ts": `declare {};()=>{};`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "1 | declare {};()=>{};
                ^
    error: Unexpected {
        at <dir>/test.ts:1:9"
  `);
  expect(exitCode).toBe(1);
});

test("declare multiple blocks followed by arrow should error", async () => {
  using dir = tempDir("declare-multi-blocks", {
    "test.ts": `declare{}{;}()=>{};`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "1 | declare{}{;}()=>{};
               ^
    error: Unexpected {
        at <dir>/test.ts:1:8"
  `);
  expect(exitCode).toBe(1);
});

test("declare followed by semicolon should error", async () => {
  using dir = tempDir("declare-semicolon", {
    "test.ts": `declare;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "1 | declare;
               ^
    error: Unexpected ;
        at <dir>/test.ts:1:8"
  `);
  expect(exitCode).toBe(1);
});

test("declare followed by number should error", async () => {
  using dir = tempDir("declare-number", {
    "test.ts": `declare 123;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "1 | declare 123;
                ^
    error: Unexpected 123
        at <dir>/test.ts:1:9"
  `);
  expect(exitCode).toBe(1);
});

test("valid declare statements should still work", async () => {
  using dir = tempDir("declare-valid", {
    "test.ts": `
declare const x: number;
declare let y: string;
declare var z: boolean;
declare class Foo {}
declare function bar(): void;
declare enum Baz { A, B }
declare namespace N {}
declare module M {}
declare interface I {}
declare type T = string;
declare abstract class Abstract {}
declare global {
  const GLOBAL: string;
}

console.log("SUCCESS");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});
