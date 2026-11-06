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
  ["the key function of list.sort()", "[[], [3, 1, 2]]"],
  ["a comparison of list.sort()", "[[], [1, 2, 3]]"],
  ["a comparison of list.sort() of a list that JavaScript has forbidden to grow", "[[1, 2, 3]]"],
  ["list.sort(), after the last call of its key function", "[50000]"],
  ["list.sort(), before it has called anything", "[200000]"],
  ["close() of a file, which its own __del__ has called", "['__del__']"],
  ["close() of the file under a text file, which the collector closes", "['close', 'close', 'closed', 'kept']"],
  ["close() of the file under a text file, at the end of a with statement", "['close', 'close', 'closed', 'kept']"],
  ["close() of the files under a pair, which the collector closes", "['close', 'close', 'closed', 'kept']"],
  [
    "close() of the file under a buffered file, once _IOBase says that it is closed, which the collector closes",
    "['said', 'closed']",
  ],
  [
    "close() of the file under a text file, once _IOBase says that it is closed, at the end of a with statement",
    "['said', 'closed']",
  ],
  [
    "close() of the file under a text file, which its own __del__ closes",
    "['__del__', 'close', 'close', 'closed', 'kept']",
  ],
  ["the timer of a profiler, when a function returns", "[1]"],
  ["the timer of a profiler, when a function is entered", "[(1, 0.0)]"],
  [
    "the timer of a profiler, while disable() ends the calls that are under way",
    "[('inner', 1, []), ('later', 1, []), ('outer', 1, ['inner'])]",
  ],
  ["flush() of a file that is being closed, whose descriptor is no longer open", "['flush', True]"],
  [
    "sys.unraisablehook, for what the timer of a profiler has raised",
    "['Exception ignored while calling _lsprof timer', 1]",
  ],
  ["the getter of the path of an error of the system, which JavaScript has thrown", "['a path', 'a path']"],
  [
    "the exception handler of a loop, for a future whose exception was never retrieved",
    "['Future exception was never retrieved', 'Future exception was never retrieved']",
  ],
  ["__index__ of what is looked for in bytes, which has a __buffer__ too", "[]"],
  ["__index__ of the start of an islice(), whose stop has one too", "[]"],
  ["__fspath__ of the program that os.spawnv() is to run", "['no child']"],
  ["the finalizer of a file, which asks whether it is closed", "['asked']"],
  [
    "the finalizer of a buffered file with something left to write, which asks whether it is closed",
    "['asked', b'kept']",
  ],
  ["an except clause", "[('None', 'None')]"],
  ["an except clause that names the exception, in an except clause", "[('None', 'None')]"],
  ["the expression of an except clause", "[('None', 'None')]"],
  ["a finally clause, on the way of an exception", "[('None', 'None')]"],
  ["an except* clause", "[('None', 'None')]"],
  ["__exit__, on the way of an exception", "[('None', 'None')]"],
  ["what an except clause calls", "[('None', 'None')]"],
  ["an except clause of a generator", "[('None', 'None')]"],
  [
    "an except clause of what a catch clause of JavaScript calls, which an except clause has called",
    `[("ValueError('thrown to JavaScript')", "ValueError('thrown to JavaScript')"), ('None', 'None')]`,
  ],
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

const handlersThatAreLeft = [
  "a_clause_that_is_left_at_its_end",
  "a_clause_with_a_name",
  "a_clause_that_returns",
  "a_clause_that_goes_on_with_the_loop",
  "a_clause_in_a_clause",
  "no_clause_that_matches",
  "no_clause_with_a_name_that_matches",
  "a_clause_with_a_name_that_raises_again",
  "an_async_for_whose_iterator_raises",
  "an_async_for_that_comes_to_its_end",
  "a_finally_clause",
  "clauses_for_a_group",
  "a_with_statement_that_suppresses",
  "a_with_statement_that_does_not",
  "a_clause_of_a_generator",
]
  .map(name => `('${name}', True, [])`)
  .join(", ");

// What was being handled around the script is being handled again.
test.skipIf(isWindows).concurrent.each([
  [
    "an except clause",
    `['ERR_SCRIPT_EXECUTION_INTERRUPTED', ("KeyError('outer')", "KeyError('outer')"), ('None', 'None')]`,
  ],
  [
    "a trace function, wherever it is told of something in a function that leaves a handler",
    `[${handlersThatAreLeft}, ('None', 'None')]`,
  ],
  [
    "a tool of sys.monitoring, at whichever instruction of a function that leaves a handler",
    `[${handlersThatAreLeft}, ('None', 'None')]`,
  ],
  [
    "toString() of an error of JavaScript that is caught again later",
    `['ERR_SCRIPT_EXECUTION_INTERRUPTED', 'what it says']`,
  ],
  [
    "toString() of what JavaScript has thrown, which an except clause asks",
    `['ERR_SCRIPT_EXECUTION_INTERRUPTED', ("KeyError('outer')", "KeyError('outer')"), ('None', 'None')]`,
  ],
  [
    "a generator, in an except clause of it",
    `['ERR_SCRIPT_EXECUTION_INTERRUPTED', ("KeyError('of the generator')", "KeyError('of the generator')"), ("IndexError('outer')", "IndexError('outer')"), ("KeyError('of the generator')", "KeyError('of the generator')"), ("IndexError('outer')", "IndexError('outer')"), ('None', 'None')]`,
  ],
  [
    "an except clause, and the script is in a try whose except clause is empty",
    `['ERR_SCRIPT_EXECUTION_INTERRUPTED', ("KeyError('outer')", "KeyError('outer')"), ('None', 'None')]`,
  ],
  [
    "an except clause, and the script is in a try whose except clause only returns",
    `['ERR_SCRIPT_EXECUTION_INTERRUPTED', ("KeyError('outer')", "KeyError('outer')"), ('None', 'None')]`,
  ],
  [
    "an except clause, and in the script a catch clause of JavaScript",
    `[("ValueError('thrown to JavaScript')", "ValueError('thrown to JavaScript')"), 'ERR_SCRIPT_EXECUTION_INTERRUPTED', ("IndexError('outer')", "IndexError('outer')"), ('None', 'None')]`,
  ],
])("SIGINT breaks, in an except clause, a script of node:vm that was run in %s", async (where, log) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", "interrupt-at-work-fixture.ts"), where, "goes on"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: `returned\n${log}\nthe end\n`, stderr: "" });
  expect(exitCode).toBe(0);
});

// Wherever the timeouts happen to come: in open(), in a method of the file, in its close(), in its finalizer.
test
  .skipIf(isWindows)
  .concurrent.each([
    "a file that nothing refers to",
    "a file in a variable",
    "a file of a with statement",
    "a buffered file of a with statement",
    "a text file of a with statement",
  ])("no descriptor stays open when the timeouts of node:vm end scripts that open %s", async what => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", "timeout-with-files-fixture.ts"), what],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "40 ended, 0 still open\n", stderr: "" });
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
