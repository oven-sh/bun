import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/24538
// process.getActiveResourcesInfo() was always returning [], causing Expo to hang

test("process.getActiveResourcesInfo returns array", () => {
  const result = process.getActiveResourcesInfo();
  expect(result).toBeInstanceOf(Array);
});

test("process.getActiveResourcesInfo reports active setTimeout", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const t = setTimeout(() => {}, 100000);
const resources = process.getActiveResourcesInfo();
console.log(JSON.stringify(resources));
clearTimeout(t);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const resources = JSON.parse(stdout.trim());
  expect(resources).toContain("Timeout");
  expect(exitCode).toBe(0);
});

test("process.getActiveResourcesInfo reports active setInterval", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const iv = setInterval(() => {}, 100000);
const resources = process.getActiveResourcesInfo();
console.log(JSON.stringify(resources));
clearInterval(iv);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const resources = JSON.parse(stdout.trim());
  expect(resources).toContain("Timeout");
  expect(exitCode).toBe(0);
});

test("process.getActiveResourcesInfo reports active TCP server", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const net = require('net');
const server = net.createServer();
server.listen(0, () => {
  const resources = process.getActiveResourcesInfo();
  console.log(JSON.stringify(resources));
  server.close();
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const resources = JSON.parse(stdout.trim());
  expect(resources.length).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});

test("process.getActiveResourcesInfo returns empty array with no resources", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const resources = process.getActiveResourcesInfo();
console.log(JSON.stringify(resources));
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const resources = JSON.parse(stdout.trim());
  expect(resources).toEqual([]);
  expect(exitCode).toBe(0);
});

test("process.getActiveResourcesInfo reports multiple timers", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const t1 = setTimeout(() => {}, 100000);
const t2 = setTimeout(() => {}, 100000);
const t3 = setTimeout(() => {}, 100000);
const resources = process.getActiveResourcesInfo();
console.log(JSON.stringify(resources));
clearTimeout(t1);
clearTimeout(t2);
clearTimeout(t3);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const resources = JSON.parse(stdout.trim());
  const timeoutCount = resources.filter((r: string) => r === "Timeout").length;
  expect(timeoutCount).toBe(3);
  expect(exitCode).toBe(0);
});

test("process.getActiveResourcesInfo reports Immediate for setImmediate", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
setImmediate(() => {});
const resources = process.getActiveResourcesInfo();
console.log(JSON.stringify(resources));
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const resources = JSON.parse(stdout.trim());
  expect(resources).toContain("Immediate");
  expect(exitCode).toBe(0);
});
