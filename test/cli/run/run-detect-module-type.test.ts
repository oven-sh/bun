import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// package.json "type" -> file name -> expected module type of the main entry
const table = {
  cjs: {
    "hello.cjs": "commonjs",
    "hello.js": "commonjs",
    "hello.mjs": "module",
    "hello.ts": "commonjs",
    "hello.tsx": "module",
    "hello.cts": "commonjs",
    "hello.jsx": "module",
    "hello.mts": "module",
    // files using ES import and no exports will be detected as module
    "import.cjs": "module",
  },
  esm: {
    "hello.cjs": "commonjs",
    "hello.js": "module",
    "hello.mjs": "module",
    "hello.ts": "module",
    "hello.tsx": "module",
    "hello.cts": "commonjs",
    "hello.jsx": "module",
    "hello.mts": "module",
    // files using ES import and no exports will be detected as module
    "import.cjs": "module",
  },
} as const;

const cases = Object.entries(table).flatMap(([packageType, files]) =>
  Object.entries(files).map(([file, expectedType]) => ({ packageType, file, expectedType })),
);

test("detect module type", async () => {
  // each fixture prints `typeof module === 'undefined'`: "false" means it ran as commonjs
  const actual = await Promise.all(
    cases.map(async ({ packageType, file }) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", join(import.meta.dir, "module-type-fixture", packageType, file)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) {
        throw new Error(`Failed to run ${packageType}/${file}: ${stderr.trim()}`);
      }
      if (stderr !== "") {
        throw new Error(`Unexpected stderr from ${packageType}/${file}: ${stderr.trim()}`);
      }
      const out = stdout.trim();
      const detected =
        out === "true" ? "module" : out === "false" ? "commonjs" : `unexpected output ${JSON.stringify(out)}`;
      return `${packageType} ${file} -> ${detected}`;
    }),
  );

  expect(actual).toEqual(
    cases.map(({ packageType, file, expectedType }) => `${packageType} ${file} -> ${expectedType}`),
  );
});
