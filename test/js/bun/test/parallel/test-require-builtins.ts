import { spawnSync } from "child_process";
import { builtinModules } from "node:module";
import { tempDirWithFiles } from "./../../../../harness";
import { join } from "node:path";
import { expect } from "bun:test";

for (let builtin of builtinModules) {
  const safe = builtin.replaceAll("/", "_").replaceAll(":", "_");
  const base = safe + ".cjs";
  const dir = tempDirWithFiles("", {
    [`${base}`]: `
const builtin = ${JSON.stringify(builtin)};
console.log(builtin);
const now = performance.now();
require(builtin);
const end = performance.now();
console.log(JSON.stringify({ builtin, time: end - now }));
    `,
  });
  const path = join(dir, base);
  const proc = spawnSync(process.execPath, [path], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });
  expect(proc.signal).toBeNull();
  expect(proc.status).toBe(0);
}
