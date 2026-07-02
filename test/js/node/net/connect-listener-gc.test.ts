import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// A fired once('connect') listener must be collectable by one explicit gc().
// The fixture runs in child processes with differently padded environments:
// whether the conservative GC scan resurrects the dead listener depends on the
// child's initial stack alignment, so one alignment proves nothing.
// https://github.com/oven-sh/bun/issues/33044
const fixture = String.raw`
  const net = require("net");
  const assert = require("assert");

  const ROUNDS = 4;
  let done = 0;
  // The registry must outlive every round (a collected registry never runs its
  // cleanup callbacks). The held value is a per-round callback.
  const registry = new FinalizationRegistry(ongc => ongc());

  function round() {
    const server = net.createServer(() => {}).listen(0, () => {
      let collected = false;
      // Created OUTSIDE the block below: a held value must not share a scope
      // with the registration target or the registry itself keeps it alive.
      const onCollected = () => {
        collected = true;
      };
      // Block scope: after 'connect' fires and the once() listener is removed,
      // nothing should reference gcObject.
      {
        const gcObject = {};
        registry.register(gcObject, onCollected);
        const sock = net.createConnection(server.address().port, () => {
          assert.strictEqual(gcObject, gcObject); // keep gcObject alive until here
          assert.strictEqual(collected, false);
          setImmediate(check, sock);
        });
      }
      function check(sock) {
        globalThis.gc();
        setImmediate(() => {
          assert.strictEqual(collected, true, "round " + done + ": the connect listener was not collected by one gc()");
          sock.end();
          server.close(() => {
            if (++done === ROUNDS) console.log("collected " + done + "/" + ROUNDS);
            else round();
          });
        });
      }
    });
  }
  round();
`;

// Debug (ASAN) children are much slower to start, so probe fewer alignments
// there; the release lanes carry the wide sweep.
const alignments = isDebug ? 2 : 16;
const batch = 4;

test("a fired once('connect') listener is collected by a single explicit gc()", async () => {
  using dir = tempDir("connect-listener-gc", { "fixture.js": fixture });

  const run = async (i: number) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--expose-gc", "fixture.js"],
      // The padding changes only the size of the child's environment block,
      // which shifts its initial stack pointer (see the comment at the top).
      env: { ...bunEnv, BUN_TEST_STACK_ALIGNMENT_PAD: "x".repeat(1 + i * 13) },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { pad: i, stdout: stdout.trim(), stderr: exitCode === 0 ? "" : stderr, exitCode };
  };

  const results: Awaited<ReturnType<typeof run>>[] = [];
  for (let i = 0; i < alignments; i += batch) {
    const wave = [];
    for (let j = i; j < Math.min(i + batch, alignments); j++) wave.push(run(j));
    results.push(...(await Promise.all(wave)));
  }

  expect(results).toEqual(
    Array.from({ length: alignments }, (_, pad) => ({
      pad,
      stdout: "collected 4/4",
      stderr: "",
      exitCode: 0,
    })),
  );
});
