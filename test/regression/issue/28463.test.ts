import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/28463
// getColorDepth() should return 24 inside tmux when COLORTERM=truecolor is set,
// because the COLORTERM check should take priority over the TMUX check.

test("getColorDepth returns 24 when TMUX and COLORTERM=truecolor are both set", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const tty = require("tty");
      const depth = tty.WriteStream.prototype.getColorDepth.call({ isTTY: true }, process.env);
      console.log(depth);
      `,
    ],
    env: {
      ...bunEnv,
      TMUX: "/tmp/tmux-test,1234,0",
      COLORTERM: "truecolor",
      // Clear vars that would short-circuit earlier
      FORCE_COLOR: undefined,
      NO_COLOR: undefined,
      NODE_DISABLE_COLORS: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("24");
  expect(exitCode).toBe(0);
});

test("getColorDepth returns 24 when TMUX and COLORTERM=24bit are both set", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const tty = require("tty");
      const depth = tty.WriteStream.prototype.getColorDepth.call({ isTTY: true }, process.env);
      console.log(depth);
      `,
    ],
    env: {
      ...bunEnv,
      TMUX: "/tmp/tmux-test,1234,0",
      COLORTERM: "24bit",
      FORCE_COLOR: undefined,
      NO_COLOR: undefined,
      NODE_DISABLE_COLORS: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("24");
  expect(exitCode).toBe(0);
});

test("getColorDepth returns 8 when TMUX is set without COLORTERM=truecolor", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const tty = require("tty");
      const depth = tty.WriteStream.prototype.getColorDepth.call({ isTTY: true }, process.env);
      console.log(depth);
      `,
    ],
    env: {
      ...bunEnv,
      TMUX: "/tmp/tmux-test,1234,0",
      COLORTERM: undefined,
      FORCE_COLOR: undefined,
      NO_COLOR: undefined,
      NODE_DISABLE_COLORS: undefined,
      TERM: undefined,
      TERM_PROGRAM: undefined,
      CI: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("8");
  expect(exitCode).toBe(0);
});

test("hasColors(16777216) returns true when TMUX and COLORTERM=truecolor are both set", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const tty = require("tty");
      const ws = new tty.WriteStream(1);
      // Pass env explicitly to getColorDepth via hasColors
      console.log(ws.hasColors(16777216, process.env));
      `,
    ],
    env: {
      ...bunEnv,
      TMUX: "/tmp/tmux-test,1234,0",
      COLORTERM: "truecolor",
      FORCE_COLOR: undefined,
      NO_COLOR: undefined,
      NODE_DISABLE_COLORS: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("true");
  expect(exitCode).toBe(0);
});
