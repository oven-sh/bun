// Deeply nested array binding patterns emit O(N) basic blocks with O(N) branches
// (each level wraps IteratorClose in a synthesized try/finally). BytecodeBasicBlock
// linked successor blocks by linearly scanning the basic block list for every branch
// and throw target, making basic block / liveness analysis O(N^2): a 2500-deep
// pattern took ~4s in a release build and minutes under debug+ASAN. The lookup is
// now a binary search over the already-sorted block list, the same lookup
// BytecodeGraph::findBasicBlockWithLeaderOffset uses.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("deeply nested array binding pattern compiles in time linear in nesting depth", async () => {
  // Large enough that the old O(N^2) basic block linking blows the spawn timeout under
  // the debug+ASAN build while staying comfortably under the bindValue native stack
  // budget on every platform.
  const depth = 1200;
  const src =
    "try { let " +
    Buffer.alloc(depth, "[").toString() +
    "z" +
    Buffer.alloc(depth, "]").toString() +
    " = w } catch (e) { console.log('caught', e.constructor.name) }";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "caught ReferenceError\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
}, 30_000);
