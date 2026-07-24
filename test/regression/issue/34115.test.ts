// https://github.com/oven-sh/bun/issues/34115
// A preload script that touches process.nextTick (directly, or via a module that
// does) must not change the relative order of process.nextTick vs microtasks
// scheduled at the top level of the entry module.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const orderFixture = `
process.nextTick(() => console.log("nextTick"));
queueMicrotask(() => console.log("microtask"));
Promise.resolve().then(() => console.log("promise"));
`;

describe("process.nextTick ordering is preserved with --preload", () => {
  test.each([
    ["that reads process.nextTick", `process.nextTick;`],
    ["that calls process.nextTick", `process.nextTick(() => console.log("preload-tick"));`, "preload-tick\n"],
    ["that requires node:stream", `require("node:stream");`],
    ["that requires node:zlib", `require("node:zlib");`],
  ])("preload %s", async (_name, preloadBody, preloadOutput = "") => {
    using dir = tempDir("issue-34115-order", {
      "preload.js": preloadBody,
      "order.js": orderFixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./preload.js", "order.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(preloadOutput + "nextTick\nmicrotask\npromise\n");
    expect(exitCode).toBe(0);
  });

  test("preserved with two preload scripts", async () => {
    using dir = tempDir("issue-34115-two-preloads", {
      "preload-a.js": `process.nextTick(() => console.log("a"));`,
      "preload-b.js": `process.nextTick(() => console.log("b"));`,
      "order.js": orderFixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./preload-a.js", "--preload", "./preload-b.js", "order.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("a\nb\nnextTick\nmicrotask\npromise\n");
    expect(exitCode).toBe(0);
  });
});

test("Writable.toWeb() close rejects with ABORT_ERR when preload requires node:stream", async () => {
  using dir = tempDir("issue-34115-writable", {
    "preload.js": `require("node:stream");`,
    "repro.js": `
      const { Writable } = require("stream");
      const w = new Writable({ write(c, e, cb) { cb(); } });
      const ws = Writable.toWeb(w);
      ws.close().then(
        () => console.log("RESOLVED"),
        e => console.log("rejected:", e.code),
      );
      w.end();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.js", "repro.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("rejected: ABORT_ERR\n");
  expect(exitCode).toBe(0);
});
