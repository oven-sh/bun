// https://github.com/oven-sh/bun/issues/3216
import { test, expect } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe, tmpdirSync } from "harness";

test("runtime directory caching gets invalidated", () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "index.ts"),
    `const file = \`\${import.meta.dir}/temp.mjs\`;
const file2 = \`\${import.meta.dir}/second.mjs\`;

import { existsSync, unlinkSync, writeFileSync } from "fs";

if (existsSync(file) || existsSync(file2)) {
  console.log("temp.mjs cannot exist before running this script");
  try { unlinkSync(file); } catch {}
  try { unlinkSync(file2); } catch {}
  process.exit(2);
}

writeFileSync(file, "export default 1;");

try {
  const module = await import(file);
  console.log(module.default);
} finally {
  unlinkSync(file);
}

writeFileSync(file2, "export default 2;");

try {
  const module = await import(file2);
  console.log(module.default);
} finally {
  unlinkSync(file2);
}
`,
  );

  const result = Bun.spawnSync({
    cmd: [bunExe(), "run", join(tmp, "index.ts")],
    cwd: tmp,
    env: bunEnv,
  });

  if (result.exitCode !== 0) {
    console.log(result.stderr.toString("utf-8"));
  }

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString("utf-8")).toBe("1\n2\n");
});
