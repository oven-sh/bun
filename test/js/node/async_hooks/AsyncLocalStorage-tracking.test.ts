import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { basename, join } from "path";

// Every fixture in async-context/ calls one API inside asyncLocalStorage.run() and
// exits 0 without printing anything if all of its callbacks still see the store.
// Otherwise it prints "FAIL: ..." (context lost) or "ERROR: ..." (the API itself
// failed) to stderr and exits 1. Fixtures only talk to servers they start
// themselves, so none of this depends on the network.
//
// Each fixture also runs under node, which proves the fixture itself is valid.
const node = nodeExe();
if (!node) throw new Error("node is required to validate the async-context fixtures");

const fixturesDir = join(import.meta.dir, "async-context");
const fixtures = [...new Glob("async-context-*.js").scanSync(fixturesDir)].sort();

// Fixtures bun still fails. `bun test --todo` runs them and reports any that
// have started passing.
const todos = ["async-context-worker_threads-message.js"];

async function run(exe: string, fixture: string, cwd: string) {
  await using proc = Bun.spawn({
    cmd: [exe, join(fixturesDir, fixture)],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { exe: basename(exe), fixture, stdout, stderr, exitCode, signalCode: proc.signalCode };
}

function passed(exe: string, fixture: string) {
  return { exe: basename(exe), fixture, stdout: "", stderr: "", exitCode: 0, signalCode: null };
}

describe.concurrent("AsyncLocalStorage passes context to callbacks", () => {
  test("every todo entry names an existing fixture", () => {
    expect(fixtures).toEqual(expect.arrayContaining(todos));
  });

  for (const fixture of fixtures) {
    const name = fixture.replace(/^async-context-/, "").replace(/\.js$/, "");

    test.todoIf(todos.includes(fixture))(name, async () => {
      // Some fixtures create scratch files relative to the cwd.
      using cwd = tempDir("async-context", {});

      const results = await Promise.all([run(bunExe(), fixture, String(cwd)), run(node, fixture, String(cwd))]);

      expect(results).toEqual([passed(bunExe(), fixture), passed(node, fixture)]);
    });
  }
});
