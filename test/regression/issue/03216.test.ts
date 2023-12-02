// https://github.com/oven-sh/bun/issues/3216
import { test, expect } from "bun:test";
import { tmpdir } from "os";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe } from "harness";

test("runtime directory caching gets invalidated", () => {
  const tmp = mkdtempSync(join(tmpdir(), "bun-test-"));
  writeFileSync(
    join(tmp, "index.ts"),
    `const file = \`\${import.meta.dir}/temp.mjs\`;

import { existsSync, unlinkSync, writeFileSync } from "fs";

if (existsSync(file)) {
  console.log("temp.mjs cannot exist before running this script");
  unlinkSync(file);
  process.exit(2);
}

writeFileSync(file, "export default 1;");

try {
  const module = await import(file);
  console.log(module.default);
} finally {
  unlinkSync(file);
}
`,
  );

  const result = Bun.spawnSync({
    cmd: [bunExe(), "run", join(tmp, "index.ts")],
    cwd: tmp,
    env: bunEnv,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString("utf-8")).toBe("1\n");
});
