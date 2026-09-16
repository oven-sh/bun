import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Every event loop turn that resumes an async function runs a microtask checkpoint at the same stack
// depth, so the frames of JSC's drain and of runInternalMicrotask() are at the same addresses in
// every turn, and a job writes only some of their slots. Unless the checkpoint first clears the stack
// that those frames are going to occupy, what a job of an earlier turn left there is a root of every
// Bun.gc(true) that a job of a later turn makes. Here that is the generator of an async function that
// has finished: it stays at rbp-64 of runInternalMicrotask()'s frame, and with it everything that the
// function held, for as long as the turns keep coming.
//
// Each case runs in a fresh process: which words are stale depends on what ran before.
const fixture = /* js */ `
  const [shape, via] = process.argv.slice(2);
  const turn = () =>
    via === "Bun.sleep"
      ? Bun.sleep(1)
      : new Promise(resolve => (via === "setTimeout" ? setTimeout(resolve, 0) : setImmediate(resolve)));

  const refs = [];
  async function makeGarbage() {
    const list = [];
    for (let i = 0; i < 2; i++) {
      const object = { i };
      list.push(object);
      refs.push(new WeakRef(object));
      await turn();
    }
    await Promise.all(list.map(object => Promise.resolve(object.i)));
  }

  // A WeakRef keeps its target until the end of the turn that read it, so each collection is in a
  // turn of its own. The stack scan is conservative: a few turns for anything else that happens to
  // look like one of the objects. What the checkpoint's frames keep, they keep in every turn.
  let alive;
  let collections = 0;
  async function collectFromAnAsyncFunction() {
    do {
      await turn();
      Bun.gc(true);
      collections++;
      alive = refs.filter(ref => ref.deref() !== undefined).length;
    } while (alive > 0 && collections < 8);
  }

  await makeGarbage();
  if (shape === "an async function") {
    await collectFromAnAsyncFunction();
  } else {
    // The same loop, in the continuation of this module's top-level await.
    do {
      await turn();
      Bun.gc(true);
      collections++;
      alive = refs.filter(ref => ref.deref() !== undefined).length;
    } while (alive > 0 && collections < 8);
  }
  console.log(JSON.stringify({ alive, collections }));
`;

describe.concurrent("what a finished async function held is collected from a later event loop turn", () => {
  for (const shape of ["the module", "an async function"]) {
    for (const via of ["setTimeout", "setImmediate", "Bun.sleep"]) {
      test(`by ${shape}, turns via ${via}`, async () => {
        using dir = tempDir("microtask-checkpoint-stale-stack", { "fixture.mjs": fixture });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "fixture.mjs", shape, via],
          // The collector's own timer also runs on the event loop. The test is about the turns of the
          // fixture, so keep it out of them.
          env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
          cwd: String(dir),
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toMatchObject({ alive: 0 });
        expect(exitCode).toBe(0);
      });
    }
  }
});
