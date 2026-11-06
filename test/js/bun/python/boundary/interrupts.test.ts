// What Python is in the middle of is cut short, and then the program goes on.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";
import { join } from "node:path";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(120_000);

// What is left undone is done later, once, and nothing is done that the interruption should have kept from being done.
test.skipIf(isWindows).concurrent.each([
  [
    "sys.unraisablehook, before the handlers of signals are called",
    "['Exception ignored while trying to write to the signal wakeup fd', 'SIGUSR1']",
  ],
  ["sys.unraisablehook, between the handlers of two signals", "['first', 'hook', 'third']"],
  [
    "sys.unraisablehook, between two of gc.callbacks",
    "['first start', 'hook', 'first start', 'second start', 'first stop', 'second stop', 1]",
  ],
  ["sys.unraisablehook, between two finalizers", "['finalizer', 'finalizer', 'hook', 'finalizer', 'finalizer']"],
  ["sys.unraisablehook, between two callbacks of atexit", "['first', 'second', 'hook', 2, 'third', 'fourth']"],
  ["sys.stderr.write(), for gc.DEBUG_STATS", "['start', 'write', 'start', 'write', 'write', 'stop']"],
  ["the finalizer of a stream, which asks whether it is closed", "['closed']"],
  ["sys.unraisablehook, between two streams with something left to write", "['hook', b'kept', b'kept too']"],
  ["the finally of a generator, while an exception leaves its loop", "['finally']"],
  ["a function that C calls", "['compare']"],
  ["an audit hook, for what the initializer of a module imports", "['hook', True]"],
  ["a trace function that is told of an exception", "['exception', None]"],
  ["__buffer__ of what a file that nothing else refers to is to read into", "[]"],
  ["__buffer__ of the second of two things to join, when the first is to be told of its release", "['released']"],
])("SIGINT breaks a script of node:vm in %s", async (where, log) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", "interrupt-at-work-fixture.ts"), where],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: `ERR_SCRIPT_EXECUTION_INTERRUPTED\n${log}\nthe end\n`, stderr: "" });
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("an exception reaches its handler though a script was broken on the way", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "fixtures", "interrupt-at-work-fixture.ts"),
      "a script within the finally of a generator, while an exception leaves its loop",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({
    stdout: `returned\n['ERR_SCRIPT_EXECUTION_INTERRUPTED', ("ValueError('on its way')", None)]\nthe end\n`,
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)(
  "the interpreter is whole though SIGINT broke the script in which it was first used",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "interrupt-at-start-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "ERR_SCRIPT_EXECUTION_INTERRUPTED\n[''] ''\n", stderr: "" });
    expect(exitCode).toBe(0);
  },
);
