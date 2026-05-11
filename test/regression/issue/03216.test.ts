// https://github.com/oven-sh/bun/issues/3216
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("issue/03216", () => {
  test("runtime directory caching gets invalidated", async () => {
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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(tmp, "index.ts")],
      cwd: tmp,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log(stderr);
    }

    expect(stdout).toBe("1\n2\n");
    expect(exitCode).toBe(0);
  });
});
