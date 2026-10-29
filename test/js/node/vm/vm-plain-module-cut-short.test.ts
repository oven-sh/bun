import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// A plain ES module is one that the program's own loader made, not a vm.SourceTextModule. A run that stops its
// evaluation leaves it over, like a module that threw. As in Node, its error is then null for every later use, and
// never the engine's own value for a stopped run (the string "JavaScript execution terminated."). The module to stop
// waits in Atomics.wait for longer than the run has, so a run that stops nothing fails the test and nothing hangs.
describe("a plain ES module whose evaluation a vm run stops", () => {
  const fixture = join(import.meta.dir, "vm-plain-module-cut-short-fixture.cjs");
  const entryPoints = [
    "vm.runInContext",
    "vm.runInNewContext",
    "vm.runInThisContext",
    "script.runInContext",
    "script.runInNewContext",
    "script.runInThisContext",
  ];
  const rejected = "rejected with null";
  const importedTwice = (scenario: string, code: string) => ({
    scenario,
    run: `threw ${code}`,
    import: rejected,
    importAgain: rejected,
    log: "wait",
  });

  // The fixture prints one JSON line for each scenario.
  async function cutShort(how: "timeout" | "sigint", scenarios: string[]) {
    using dir = tempDir("vm-plain-module-cut-short", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, how, ...scenarios],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    return { stdout: lines.map(line => (line.startsWith("{") ? JSON.parse(line) : line)), stderr, exitCode };
  }

  // With "sigint", the module sends the SIGINT itself, so the first run stops inside its body. A timeout can pass
  // before the body starts, and the fixture then tries again with a longer one. So most scenarios use a SIGINT
  // where there is one.
  const how = isWindows ? "timeout" : "sigint";
  const code = isWindows ? "ERR_SCRIPT_EXECUTION_TIMEOUT" : "ERR_SCRIPT_EXECUTION_INTERRUPTED";
  const timedOut = "ERR_SCRIPT_EXECUTION_TIMEOUT";

  test.concurrent.each<[string, "timeout" | "sigint", Record<string, string>[]]>([
    [
      "a timeout",
      "timeout",
      [importedTwice("vm.runInContext", timedOut), importedTwice("script.runInThisContext", timedOut)],
    ],
    [`each entry point (${how})`, how, entryPoints.map(entryPoint => importedTwice(entryPoint, code))],
    [
      `each way to require() it, and each later use (${how})`,
      how,
      [
        { scenario: "createRequire()", run: `threw ${code}`, import: rejected, log: "wait" },
        { scenario: "module.require()", run: `threw ${code}`, import: rejected, log: "wait" },
        // The handler's try/catch around the handler that it replaced does not catch what stops the run.
        {
          scenario: "require.extensions",
          run: `threw ${code}, the handler caught nothing`,
          import: rejected,
          log: "wait",
        },
        {
          scenario: "graph",
          run: `threw ${code}`,
          // On the stack of the evaluation when the run stopped it: the root, and the module that was running.
          root: rejected,
          wait: rejected,
          // Finished before that.
          leaf: "fulfilled",
          // Not reached. It runs at its own import().
          never: "fulfilled",
          log: "leaf,wait,never",
        },
        // A module that imports it, and that is evaluated for the first time after the run.
        {
          scenario: "a later importer",
          run: `threw ${code}`,
          require: "threw null",
          requireAgain: "threw null",
          import: rejected,
          log: "wait",
        },
        { scenario: "inner run", run: `the inner run threw ${code}`, import: rejected, log: "wait" },
        { scenario: "outer run", run: `threw ${code}`, import: rejected, log: "wait" },
        // The vm.SourceTextModule itself keeps the error of the run, where Node has null.
        {
          scenario: "SourceTextModule",
          run: `evaluate() rejected with ${code}, status errored, error ${code}`,
          import: rejected,
          log: "wait",
        },
        // The same for a graph of vm.SourceTextModules: the module that the run stopped keeps the error of the run,
        // where Node has null. A module that imports it gets null, as in Node.
        {
          scenario: "SourceTextModule importer",
          run: `child.evaluate() rejected with ${code}, error ${code}`,
          parent: "evaluate() rejected with null, status errored, error null",
          log: "child",
        },
        // Bun only: `import defer` is not in Node. The run makes the first read of the deferred namespace.
        {
          scenario: "import defer",
          run: `threw ${code}`,
          read: "threw null",
          readNotReached: "threw null",
          import: rejected,
          log: "wait",
        },
        // require() of a module that is evaluating enters its record again. Node throws from that require().
        { scenario: "a module that requires itself", run: `threw ${code}`, import: rejected, log: "self" },
        {
          scenario: "an imported module that requires itself",
          run: `threw ${code}`,
          importer: rejected,
          self: rejected,
          log: "self",
        },
        // Bun only: in Node the require() in cycle-a.mjs throws, so cycle-b.mjs does not run.
        {
          scenario: "a require() cycle",
          run: `threw ${code}`,
          a: rejected,
          b: rejected,
          log: "cycle-a,cycle-b",
        },
        // Bun only: Node does not require() a module while an import() of it is in flight. With a timeout, an
        // attempt that stops the load of the module leaves that import() pending, so only the SIGINT has this one.
        ...(how === "sigint"
          ? [
              {
                scenario: "import() in flight",
                run: `threw ${code}`,
                inFlight: rejected,
                import: rejected,
                log: "wait",
              },
              // An import() that finds the module while it is evaluating ends as a later import() does, as in Node.
              // A timeout that stops the load of these modules leaves their import() calls pending, so only the
              // SIGINT has this one too.
              {
                scenario: "import() that joins the evaluation",
                run: `threw ${code}`,
                fromDependency: rejected,
                fromItsBody: rejected,
                import: rejected,
                log: "join-root,join-dependency",
              },
            ]
          : []),
      ],
    ],
  ])("%s", async (_, how, scenarios) => {
    const names = scenarios.map(({ scenario }) => scenario);
    expect(await cutShort(how, names)).toEqual({ stdout: scenarios, stderr: "", exitCode: 0 });
  });
});
