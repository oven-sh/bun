import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

const lockfile = `{
  "lockfileVersion": 0,
  "workspaces": {
    "": {
      "name": "something",
      "dependencies": { }, 
    },
  },
  "packages": { },
}`;

test("import bun.lock file as json", async () => {
  const dir = tempDirWithFiles("bun-lock", {
    "bun.lock": lockfile,
    "index.ts": `
    import lockfile from './bun.lock';
    const _lockfile = ${lockfile}
    if (!Bun.deepEquals(lockfile, _lockfile)) throw new Error('bun.lock wasnt imported as jsonc');
    `,
  });

  expect([join(dir, "index.ts")]).toRun();
});
