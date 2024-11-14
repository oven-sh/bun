import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";

test.each([null, undefined])(`spawnSync can pass %p as option to stdio`, input => {
  const { stdout, stderr, output } = spawnSync(bunExe(), { stdio: [input, input, input] });
  expect(stdout).toBeInstanceOf(Buffer);
  expect(stderr).toBeInstanceOf(Buffer);
  expect(output).toStrictEqual([null, stdout, stderr]);
});

test.each([null, undefined])(`spawn can pass %p as option to stdio`, input => {
  const { stdout, stderr, stdio } = spawn(bunExe(), { stdio: [input, input, input] });
  expect(stdout).toBeInstanceOf(Readable);
  expect(stderr).toBeInstanceOf(Readable);
  expect(stdio).toBeArrayOfSize(3);
  expect(stdio.slice(1)).toStrictEqual([stdout, stderr]);
});
