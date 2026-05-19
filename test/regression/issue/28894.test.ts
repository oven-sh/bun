// https://github.com/oven-sh/bun/issues/28894
// `fs.Dir` async iterator should close the directory handle on exit
// (natural completion, `break`, or thrown error) to match Node.js.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { opendir as opendirPromise } from "node:fs/promises";

test("Dir async iterator closes handle on break", async () => {
  using dir = tempDir("dir-iter-break", {
    "a.txt": "",
    "b.txt": "",
    "c.txt": "",
  });
  const d = await opendirPromise(String(dir));

  const names: string[] = [];
  for await (const entry of d) {
    names.push(entry.name);
    break;
  }
  expect(names).toHaveLength(1);

  // The iterator should have closed the handle. A second close must throw.
  expect(() => d.closeSync()).toThrow("Directory handle was closed");
});

test("Dir async iterator closes handle on natural completion", async () => {
  using dir = tempDir("dir-iter-complete", {
    "x.txt": "",
    "y.txt": "",
  });
  const d = await opendirPromise(String(dir));

  const names: string[] = [];
  for await (const entry of d) {
    names.push(entry.name);
  }
  expect(names.sort()).toEqual(["x.txt", "y.txt"]);

  expect(() => d.closeSync()).toThrow("Directory handle was closed");
});

test("Dir async iterator closes handle when body throws", async () => {
  using dir = tempDir("dir-iter-throw", {
    "a.txt": "",
    "b.txt": "",
  });
  const d = await opendirPromise(String(dir));

  await expect(
    (async () => {
      for await (const _entry of d) {
        throw new Error("boom");
      }
    })(),
  ).rejects.toThrow("boom");

  expect(() => d.closeSync()).toThrow("Directory handle was closed");
});

test("Dir async iterator throws ERR_DIR_CLOSED on second iteration after auto-close", async () => {
  using dir = tempDir("dir-iter-reiter", {
    "a.txt": "",
    "b.txt": "",
  });
  const d = await opendirPromise(String(dir));

  for await (const _entry of d) {
    break;
  }

  // The first iteration auto-closed the handle. A second iteration must
  // throw ERR_DIR_CLOSED immediately instead of silently re-yielding cached
  // entries. Matches Node's behavior.
  await expect(
    (async () => {
      for await (const _entry of d) {
        // unreachable
      }
    })(),
  ).rejects.toThrow("Directory handle was closed");
});

test("Dir async iterator throws ERR_DIR_CLOSED when user closed manually inside loop", async () => {
  using dir = tempDir("dir-iter-user-closed", {
    "a.txt": "",
  });
  const d = await opendirPromise(String(dir));

  // Matches Node: when the user closes the handle inside the loop, the
  // iterator's finally tries to close again and the resulting ERR_DIR_CLOSED
  // propagates out of the `for await`.
  await expect(
    (async () => {
      for await (const _entry of d) {
        d.closeSync();
        break;
      }
    })(),
  ).rejects.toThrow("Directory handle was closed");
});
