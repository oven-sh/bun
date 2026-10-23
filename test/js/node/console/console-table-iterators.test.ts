import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const prelude = /* js */ `
  const { Console } = require("node:console");
  const c = new Console({ stdout: process.stdout, stderr: process.stderr, colorMode: false });
`;

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", prelude + script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  return { stdout, exitCode };
}

// A broken Console builtin aborts the whole process the moment `node:console`
// is loaded, so this has to be a spawned fixture: an in-process test in
// console.test.ts would take the test runner down with it.
test.concurrent("console.Console#table renders Map and Set iterators", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    c.table(new Map([["a", 1], ["b", 2]]).entries());
    c.table(new Set([7, 8]).values());
  `);
  expect(stdout).toMatchInlineSnapshot(`
    "┌───────────────────┬─────┬────────┐
    │ (iteration index) │ Key │ Values │
    ├───────────────────┼─────┼────────┤
    │         0         │ 'a' │   1    │
    │         1         │ 'b' │   2    │
    └───────────────────┴─────┴────────┘
    ┌───────────────────┬────────┐
    │ (iteration index) │ Values │
    ├───────────────────┼────────┤
    │         0         │   7    │
    │         1         │   8    │
    └───────────────────┴────────┘
    "
  `);
  expect(exitCode).toBe(0);
});

// Like Node.js: the rows are what the iterator has left, and the iterator does not move.
test.concurrent("console.Console#table shows what a Map or Set iterator has left and does not advance it", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const entries = new Map([["a", 1], ["b", 2], ["c", 3]]).entries();
    entries.next();
    c.table(entries);
    console.log(JSON.stringify(entries.next()));

    const values = new Set([7, 8, 9]).values();
    values.next();
    c.table(values);
    console.log(JSON.stringify(values.next()));

    c.table(new Map([["a", 1]]).keys());
    c.table(new Set([7]).entries());
  `);
  expect(stdout).toMatchInlineSnapshot(`
    "┌───────────────────┬─────┬────────┐
    │ (iteration index) │ Key │ Values │
    ├───────────────────┼─────┼────────┤
    │         0         │ 'b' │   2    │
    │         1         │ 'c' │   3    │
    └───────────────────┴─────┴────────┘
    {"value":["b",2],"done":false}
    ┌───────────────────┬────────┐
    │ (iteration index) │ Values │
    ├───────────────────┼────────┤
    │         0         │   8    │
    │         1         │   9    │
    └───────────────────┴────────┘
    {"value":8,"done":false}
    ┌───────────────────┬────────┐
    │ (iteration index) │ Values │
    ├───────────────────┼────────┤
    │         0         │  'a'   │
    └───────────────────┴────────┘
    ┌───────────────────┬────────┐
    │ (iteration index) │ Values │
    ├───────────────────┼────────┤
    │         0         │   7    │
    │         1         │   7    │
    └───────────────────┴────────┘
    "
  `);
  expect(exitCode).toBe(0);
});

// Every key and value of an iterator is a cell of its own, so an object that is
// not an array reaches the isBuffer() check of the cell formatter.
test.concurrent("console.Console#table formats object keys and values of a Map or Set iterator", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    c.table(new Map([["a", { x: 1 }], [{ k: 1 }, [1, 2]]]).entries());
    c.table(new Map([["a", { x: 1 }]]).values());
    c.table(new Set([{ x: 1 }]).entries());
  `);
  expect(stdout).toMatchInlineSnapshot(`
    "┌───────────────────┬──────────┬──────────┐
    │ (iteration index) │   Key    │  Values  │
    ├───────────────────┼──────────┼──────────┤
    │         0         │   'a'    │ { x: 1 } │
    │         1         │ { k: 1 } │ [ 1, 2 ] │
    └───────────────────┴──────────┴──────────┘
    ┌───────────────────┬──────────┐
    │ (iteration index) │  Values  │
    ├───────────────────┼──────────┤
    │         0         │ { x: 1 } │
    └───────────────────┴──────────┘
    ┌───────────────────┬──────────┐
    │ (iteration index) │  Values  │
    ├───────────────────┼──────────┤
    │         0         │ { x: 1 } │
    │         1         │ { x: 1 } │
    └───────────────────┴──────────┘
    "
  `);
  expect(exitCode).toBe(0);
});

// The replaced functions never report done. On a build that lets them run
// without a bound, the guard ends the child process and the output shows how
// far it got.
const guard = /* js */ `
  let calls = 0;
  function guard() {
    if (++calls > 5000) {
      console.log("RUNAWAY calls=" + calls);
      process.exit(2);
    }
  }
`;

test.concurrent("console.Console#table does not run a replaced next() of a Map or Set iterator", async () => {
  const { stdout, exitCode } = await run(
    guard +
      /* js */ `
    const entries = new Map([["a", 1], ["b", 2]]).entries();
    const values = new Set([7, 8]).values();
    Object.getPrototypeOf(entries).next = () => (guard(), { value: ["k", "v"], done: false });
    Object.getPrototypeOf(values).next = () => (guard(), { value: "v", done: false });
    c.table(entries);
    c.table(values);
    console.log("calls=" + calls);
  `,
  );
  expect(stdout).toMatchInlineSnapshot(`
    "┌───────────────────┬─────┬────────┐
    │ (iteration index) │ Key │ Values │
    ├───────────────────┼─────┼────────┤
    │         0         │ 'a' │   1    │
    │         1         │ 'b' │   2    │
    └───────────────────┴─────┴────────┘
    ┌───────────────────┬────────┐
    │ (iteration index) │ Values │
    ├───────────────────┼────────┤
    │         0         │   7    │
    │         1         │   8    │
    └───────────────────┴────────┘
    calls=0
    "
  `);
  expect(exitCode).toBe(0);
});

// A Map or a Set itself is read through its own iterator, and every entry the
// iterator yields is a row, as in Node.js. `size` does not bound it: quick-lru
// caps `size` at maxSize, and its iterator also yields the older generation.
test.concurrent("console.Console#table prints every entry that a Map subclass yields, also past its size", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    class TwoGenerations extends Map {
      #recent = [["d", 4], ["e", 5]];
      #old = [["a", 1], ["b", 2], ["c", 3]];
      get size() {
        return 3;
      }
      *[Symbol.iterator]() {
        yield* this.#recent;
        yield* this.#old;
      }
    }
    c.table(new TwoGenerations());
  `);
  expect(stdout).toMatchInlineSnapshot(`
    "┌───────────────────┬─────┬────────┐
    │ (iteration index) │ Key │ Values │
    ├───────────────────┼─────┼────────┤
    │         0         │ 'd' │   4    │
    │         1         │ 'e' │   5    │
    │         2         │ 'a' │   1    │
    │         3         │ 'b' │   2    │
    │         4         │ 'c' │   3    │
    └───────────────────┴─────┴────────┘
    "
  `);
  expect(exitCode).toBe(0);
});
