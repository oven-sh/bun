import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A Map or Set replaces its table when it rehashes. The old table keeps a pointer to the new
// one (for iterators) and its stale entries. The conservative stack scan marked the last cell
// of the MarkedBlock that sits before a 16 KB aligned pointer on the stack, as if that pointer
// were a butterfly end pointer. In release builds JSC::VM sits after the first block of small
// Map and Set tables, and VM* is always on the stack. So the first table allocated in that cell
// was never freed, and it kept every later table of its Map or Set alive, with the entries that
// were live at each rehash.
//
// Only the first Map or Set of a process that reaches that cell is hit, so each case runs in
// its own process, as a CommonJS file (other entry paths allocate in another order). A build
// with another memory layout (debug, ASAN) does not have the bug.
test.concurrent.each(["Set", "Map"])(
  "a %s that adds and removes entries in turn does not keep the removed entries alive",
  async kind => {
    using dir = tempDir("map-set-replaced-tables", {
      "churn.cjs": `
        const collection = new ${kind}();
        const refs = [];
        let previous = null;
        for (let i = 0; i < 3000; i++) {
          const value = { i };
          refs.push(new WeakRef(value));
          ${kind === "Set" ? "collection.add(value)" : "collection.set(value, i)"};
          if (previous !== null) collection.delete(previous);
          previous = value;
        }
        collection.delete(previous);
        previous = null;
        setImmediate(() => {
          Bun.gc(true);
          let alive = 0;
          for (const ref of refs) if (ref.deref() !== undefined) alive++;
          console.log(JSON.stringify({ size: collection.size, alive }));
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "churn.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { size, alive } = JSON.parse(stdout);
    expect(size).toBe(0);
    // A release build with the bug keeps about 930 of the 3000 alive.
    expect(alive).toBeLessThan(100);
    expect(exitCode).toBe(0);
  },
);
