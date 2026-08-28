/**
 * The darwin tart command hook (scripts/darwin-ci/hooks/command.ts) rsyncs the agent's checkout into a fresh
 * macOS guest with guest().syncTo() from scripts/darwin-ci/lib/guest.ts. The checkout's own .git must stay out
 * of that copy: the `git gc --auto` the agent's fetch leaves running rewrites .git while rsync reads it, and a
 * file that vanishes mid-transfer (.git/gc.pid) fails the sync, and the job with it, before any test runs.
 *
 * syncTo runs the real rsync over `-e ssh`. A fake `ssh` on PATH drops the ssh options and runs the rsync server
 * side in a local "guest home" instead, so the command under test is the one the hook runs.
 */
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { guest } from "../../scripts/darwin-ci/lib/guest.ts";

const rsync = Bun.which("rsync");

test.skipIf(isWindows || !rsync)("syncTo sends the working tree, not the checkout's .git", async () => {
  using dir = tempDir("darwin-ci-sync", {
    "checkout/package.json": `{ "name": "bun" }`,
    "checkout/.gitignore": "node_modules\n",
    "checkout/src/index.ts": "export {};\n",
    "checkout/.git/HEAD": "ref: refs/heads/main\n",
    "checkout/.git/gc.pid": "12345 host\n",
    "checkout/.git/objects/pack/pack-a.pack": "PACK",
    // a vendor clone is its own repository; only the checkout root's .git stays behind
    "checkout/vendor/elysia/.git/HEAD": "ref: refs/heads/main\n",
    "checkout/vendor/elysia/package.json": `{ "name": "elysia" }`,
    // the baked image has an empty ~/work; a leftover must still be mirrored away
    "guest/work/stale.txt": "from a previous sync\n",
  });
  const root = String(dir);
  const guestHome = join(root, "guest");

  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "bin", "ssh"),
    [
      "#!/bin/bash",
      "# stands in for ssh: drop the options (rsync passes the user as -l) and the host, then run the rsync server",
      "while [[ $1 == -* ]]; do case $1 in -i | -o | -l) shift 2 ;; *) shift ;; esac; done",
      "shift",
      `cd ${JSON.stringify(guestHome)} && exec "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  const path = process.env.PATH;
  process.env.PATH = `${join(root, "bin")}:${path}`;
  try {
    await guest("192.0.2.1").syncTo(join(root, "checkout"), "work");
  } finally {
    process.env.PATH = path;
  }

  const work = join(guestHome, "work");
  expect(existsSync(join(work, ".git"))).toBe(false);
  expect(existsSync(join(work, "stale.txt"))).toBe(false);
  expect(readFileSync(join(work, "package.json"), "utf8")).toBe(`{ "name": "bun" }`);
  expect(readFileSync(join(work, "src", "index.ts"), "utf8")).toBe("export {};\n");
  expect(readFileSync(join(work, ".gitignore"), "utf8")).toBe("node_modules\n");
  expect(readFileSync(join(work, "vendor", "elysia", ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
});
