import { expect, test } from "bun:test";
import { bunRun, tempDir } from "harness";
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

test.concurrent("import bun.lock file as json", async () => {
  await using dir = tempDir("bun-lock", {
    "bun.lock": lockfile,
    "index.ts": `
    import lockfile from './bun.lock';
    const _lockfile = ${lockfile}
    if (!Bun.deepEquals(lockfile, _lockfile)) throw new Error('bun.lock wasnt imported as jsonc');
    `,
  });

  expect(await bunRun(join(String(dir), "index.ts"))).toSpawn();
});
