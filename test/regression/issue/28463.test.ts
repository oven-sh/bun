import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// https://github.com/oven-sh/bun/issues/28463
// getColorDepth() should return 24 inside tmux when COLORTERM=truecolor is set,
// because the COLORTERM check should take priority over the TMUX check.
// On Windows, getColorDepth() returns early based on OS version before reaching
// the COLORTERM/TMUX checks, so these tests only apply to non-Windows platforms.

test.concurrent.skipIf(isWindows)(
  "getColorDepth returns 24 when TMUX and COLORTERM=truecolor are both set",
  async () => {
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

    expect(stdout.trim()).toBe("24");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)("getColorDepth returns 24 when TMUX and COLORTERM=24bit are both set", async () => {
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
      TERM: undefined,
      TERM_PROGRAM: undefined,
      CI: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("24");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)("getColorDepth returns 8 when TMUX is set without COLORTERM=truecolor", async () => {
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
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)(
  "getColorDepth returns correct value for TERM=mosh without startsWith bug",
  async () => {
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
        TERM: "mosh",
        TMUX: undefined,
        COLORTERM: undefined,
        FORCE_COLOR: undefined,
        NO_COLOR: undefined,
        NODE_DISABLE_COLORS: undefined,
        CI: undefined,
        TERM_PROGRAM: undefined,
        TEAMCITY_VERSION: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // TERM=mosh is in TERM_ENVS with COLORS_16m (24), not COLORS_256 (8)
    expect(stdout.trim()).toBe("24");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)(
  "hasColors(16777216) returns true when TMUX and COLORTERM=truecolor are both set",
  async () => {
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
        TERM: undefined,
        TERM_PROGRAM: undefined,
        CI: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("true");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);
