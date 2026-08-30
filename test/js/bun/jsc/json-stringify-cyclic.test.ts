import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/40974
// JSON.stringify on a cyclic value must throw the TypeError after bounded
// work. The JSC fast stringifier used to re-serialize the cycle until it hit
// the 2GB string length limit when an indent is passed: about 2GB of RSS and
// over a second of one thread per call. The fix (oven-sh/WebKit#540) bails the
// fast path past a depth limit, so the general Stringifier detects the cycle
// at once.
test("JSON.stringify on a cyclic value throws with bounded memory (#40974)", async () => {
  const code = `
    const throwType = fn => {
      try {
        fn();
        return null;
      } catch (e) {
        return e.constructor.name;
      }
    };

    const o = {};
    for (let i = 0; i < 8; i++) o["k" + i] = "y".repeat(50);
    o.self = o;

    const arr = [1];
    arr.push(arr);

    const a = { name: "a" };
    const b = { a };
    a.b = b; // indirect cycle a -> b -> a

    const results = {
      objFlat: throwType(() => JSON.stringify(o)),
      objIndent: throwType(() => JSON.stringify(o, null, 2)),
      arrFlat: throwType(() => JSON.stringify(arr)),
      arrIndent: throwType(() => JSON.stringify(arr, null, 2)),
      indirectIndent: throwType(() => JSON.stringify(a, null, "\\t")),
      mixedIndent: throwType(() => JSON.stringify([{ wrap: o }], null, 2)),
    };

    // Deep acyclic values past any fast-path depth limit still round-trip.
    let deep = {};
    let node = deep;
    for (let i = 0; i < 1000; i++) node = node.x = {};
    node.leaf = 1;
    let p = JSON.parse(JSON.stringify(deep, null, 2));
    for (let i = 0; i < 1000; i++) p = p.x;
    results.deepObjectLeaf = p.leaf;

    let deepArray = [];
    let arrayNode = deepArray;
    for (let i = 0; i < 1000; i++) {
      const next = [];
      arrayNode.push(next);
      arrayNode = next;
    }
    arrayNode.push("leaf");
    let q = JSON.parse(JSON.stringify(deepArray, null, 2));
    for (let i = 0; i < 1000; i++) q = q[q.length - 1];
    results.deepArrayLeaf = q[0];

    results.rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { rssMB, ...results } = JSON.parse(stdout);
  expect(results).toEqual({
    objFlat: "TypeError",
    objIndent: "TypeError",
    arrFlat: "TypeError",
    arrIndent: "TypeError",
    indirectIndent: "TypeError",
    mixedIndent: "TypeError",
    deepObjectLeaf: 1,
    deepArrayLeaf: "leaf",
  });
  // Unfixed, the indented object call alone grows RSS past 2GB (the fast
  // path's buffer doubles up to the 2GB string length limit before it gives
  // up). Fixed, the whole process stays far below this in every build config.
  expect(rssMB).toBeLessThan(1024);
  expect(exitCode).toBe(0);
});
