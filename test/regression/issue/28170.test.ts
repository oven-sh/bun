import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Regression test for https://github.com/oven-sh/bun/issues/28170
// When a barrel file with sideEffects:false re-exports a namespace import
// (`import * as X from './mod'; export { X }`), the barrel optimization
// failed to propagate the star import to the target module. This caused
// the target's own re-exports to be incorrectly deferred, resulting in
// missing function definitions in the bundled output.
test("barrel optimization propagates through namespace re-exports", async () => {
  using dir = tempDir("issue-28170", {
    // Root workspace package.json
    "package.json": JSON.stringify({
      name: "test-root",
      private: true,
      workspaces: ["packages/*"],
    }),
    // Utils package — has sideEffects: false
    "packages/pkg-utils/package.json": JSON.stringify({
      name: "@test/utils",
      version: "0.0.1",
      private: true,
      type: "module",
      sideEffects: false,
      exports: { ".": "./src/index.ts" },
    }),
    "packages/pkg-utils/src/arrays/typed/misc.ts": `
      export function toDataView(buf) {
        return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      }
    `,
    "packages/pkg-utils/src/arrays/u8/pool.ts": `
      export function alloc(size) {
        return new Uint8Array(size);
      }
    `,
    "packages/pkg-utils/src/arrays/typed/index.ts": "export { toDataView } from './misc.js';\n",
    "packages/pkg-utils/src/index.ts": `
      import * as typed from './arrays/typed/index.js';
      import * as u8 from './arrays/u8/pool.js';
      export { typed, u8 };
    `,
    // Codec package — depends on utils, has sideEffects: false
    "packages/pkg-codec/package.json": JSON.stringify({
      name: "@test/codec",
      version: "0.0.1",
      private: true,
      type: "module",
      sideEffects: false,
      exports: { ".": "./src/index.ts" },
      dependencies: { "@test/utils": "workspace:*" },
    }),
    "packages/pkg-codec/src/intermediate.ts": `
      import { typed } from '@test/utils';
      export class Codec {
        encode(data) {
          return typed.toDataView(data);
        }
      }
    `,
    "packages/pkg-codec/src/index.ts": "export { Codec } from './intermediate.js';\n",
    // App package — imports from both
    "packages/pkg-app/package.json": JSON.stringify({
      name: "@test/app",
      private: true,
      type: "module",
      dependencies: {
        "@test/codec": "workspace:*",
        "@test/utils": "workspace:*",
      },
    }),
    "packages/pkg-app/src/index.ts": `
      import { u8 } from '@test/utils';
      import { Codec } from '@test/codec';
      const codec = new Codec();
      const buf = u8.alloc(8);
      const view = codec.encode(buf);
      console.log(buf.length);
      console.log(view.byteLength);
    `,
  });

  // Install workspace dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [installStderr, installExit] = await Promise.all([installProc.stderr.text(), installProc.exited]);
  expect(installStderr).not.toContain("error:");
  expect(installExit).toBe(0);

  const outFile = path.join(String(dir), "dist", "index.js");

  // Bundle the app
  await using buildProc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      path.join(String(dir), "packages/pkg-app/src/index.ts"),
      "--outfile",
      outFile,
      "--target",
      "bun",
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [, buildStderr, buildExit] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStderr).toBe("");
  expect(buildExit).toBe(0);

  // Run the bundled output
  await using proc = Bun.spawn({
    cmd: [bunExe(), outFile],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("8\n8\n");
  expect(exitCode).toBe(0);
});
