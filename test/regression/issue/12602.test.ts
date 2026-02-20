import { $ } from "bun";
import { expect, test } from "bun:test";
import { tempDir } from "harness";

// GH-12602: Shell incorrectly strips trailing digits from command names
// when followed by a redirect operator. e.g. `./script1<file` was parsed
// as `./script` with `1<file` (fd redirect), instead of `./script1` with
// `<file` (stdin redirect).
test("command name ending in digit followed by redirect is not treated as fd redirect", async () => {
  using dir = tempDir("12602", {
    "script1": "#!/bin/sh\necho Hello from script1",
    "input.txt": "some input",
  });

  // Make script1 executable
  await $`chmod +x ${dir}/script1`.quiet();

  // ./script1<input.txt — the "1" must stay part of the command name
  const result = await $`cd ${dir} && ./script1<input.txt`.quiet();
  expect(result.text()).toBe("Hello from script1\n");
  expect(result.exitCode).toBe(0);
});

test("command name ending in '2' followed by redirect is not treated as fd redirect", async () => {
  using dir = tempDir("12602-2", {
    "script2": "#!/bin/sh\necho Hello from script2",
    "input.txt": "some input",
  });

  await $`chmod +x ${dir}/script2`.quiet();

  const result = await $`cd ${dir} && ./script2<input.txt`.quiet();
  expect(result.text()).toBe("Hello from script2\n");
  expect(result.exitCode).toBe(0);
});

test("standalone digit redirect still works", async () => {
  using dir = tempDir("12602-fd", {
    "input.txt": "hello from file",
  });

  // `cat 0<input.txt` — 0 is NOT part of a word, so it should be treated as fd redirect
  const result = await $`cd ${dir} && cat 0<input.txt`.quiet();
  expect(result.text()).toBe("hello from file");
  expect(result.exitCode).toBe(0);
});
