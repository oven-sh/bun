// https://github.com/oven-sh/bun/issues/29158
// Windows: panic 'invalid enum value' when resolving node_modules junctions
// via RtlNtStatusToDosError returning a Win32 code not in Win32Error enum.
//
// This only affects Windows. The test creates a junction in node_modules
// and verifies that Bun can resolve it without panicking.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "fs";
import path from "path";

test.if(process.platform === "win32")(
  "resolving a junction in node_modules does not panic",
  async () => {
    using dir = tempDir("bun-29158", {
      // A minimal package that bun will try to resolve through a junction
      "package.json": JSON.stringify({
        name: "test-29158",
        version: "1.0.0",
      }),
      "index.ts": `export const ok = true;`,
    });

    const dirStr = String(dir);

    // Create the actual package directory
    const pkgTarget = path.join(dirStr, "node_modules", ".real", "my-pkg");
    fs.mkdirSync(pkgTarget, { recursive: true });
    fs.writeFileSync(
      path.join(pkgTarget, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0", main: "index.js" }),
    );
    fs.writeFileSync(path.join(pkgTarget, "index.js"), `module.exports = 42;`);

    // Create a junction pointing to the real package (mirrors what bun install does)
    const junctionPath = path.join(dirStr, "node_modules", "my-pkg");
    fs.mkdirSync(path.join(dirStr, "node_modules"), { recursive: true });
    fs.symlinkSync(pkgTarget, junctionPath, "junction");

    // Bun must resolve my-pkg through the junction without panicking
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const x = require('my-pkg'); process.exit(x === 42 ? 0 : 1);`],
      env: bunEnv,
      cwd: dirStr,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("invalid enum value");
    expect(exitCode).toBe(0);
  },
);
