import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { expect, test } from "bun:test";

// module type -> file extensions -> expected module type
const table = {
  cjs: {
    'hello.cjs': 'commonjs',
    'hello.js': 'commonjs',
    'hello.mjs': 'module',
    'hello.ts': 'commonjs',
    'hello.tsx': 'module',
    'hello.cts': 'commonjs',
    'hello.jsx': 'module',
    'hello.mts': 'module',
    // files using ES import and no exports will be detected as module
    "import.cjs": "module",
  },
  esm: {
    'hello.cjs': 'commonjs',
    'hello.js': 'module',
    'hello.mjs': 'module',
    'hello.ts': 'module',
    'hello.tsx': 'module',
    'hello.cts': 'commonjs',
    'hello.jsx': 'module',
    'hello.mts': 'module',
    // files using ES import and no exports will be detected as module
    "import.cjs": "module",
  },
};

test("detect module type", () => {
  const expected = Object.entries(table).map(([moduleType, extensions]) => {
    return Object.entries(extensions).map(([extension, expected]) => {
      return `${moduleType} ${extension} -> ${expected}`;
    });
  }).flat();
 
  const actual = Object.entries(table).map(([moduleType, extensions]) => {
    return Object.entries(extensions).map(([extension, expected]) => {
      const proc =  Bun.spawnSync({
        cmd: [bunExe(), "run", join(import.meta.dir, 'module-type-fixture', moduleType, extension)],
        env: bunEnv,
      });
      if (proc.exitCode !== 0) {
        throw new Error(`Failed to run ${moduleType} ${extension}: ${proc.stderr.toString('utf8').trim()}`);
      }
      return `${moduleType} ${extension} -> ${proc.stdout.toString('utf8').trim() === "false" ? "commonjs" : "module"}`;
    });
  }).flat();

  expect(actual).toEqual(expected);
});
