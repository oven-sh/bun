import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("circular dependencies should not cause infinite recursion during hoisting", async () => {
  // This test reproduces a crash where circular dependencies in workspace packages
  // would cause infinite recursion in the hoistDependency function, leading to
  // stack overflow and segmentation fault.
  //
  // The circular dependency pattern is: pkg-a -> pkg-b -> pkg-c -> pkg-a
  //
  // The fix uses cycle detection rather than depth limiting to properly handle
  // both circular dependencies and legitimately deep dependency trees.

  const dir = tempDirWithFiles("circular-deps", {
    "package.json": JSON.stringify({
      name: "root",
      dependencies: {
        "pkg-a": "file:./pkg-a",
        "pkg-b": "file:./pkg-b",
        "pkg-c": "file:./pkg-c",
      },
      scripts: {
        "o": "bun outdated",
      },
    }),
    "pkg-a/package.json": JSON.stringify({
      name: "pkg-a",
      dependencies: {
        "pkg-b": "file:../pkg-b",
      },
    }),
    "pkg-b/package.json": JSON.stringify({
      name: "pkg-b",
      dependencies: {
        "pkg-c": "file:../pkg-c",
      },
    }),
    "pkg-c/package.json": JSON.stringify({
      name: "pkg-c",
      dependencies: {
        "pkg-a": "file:../pkg-a",
        "react": "^18.0.0",
      },
    }),
    // Include a lockfile that reproduces the problematic state
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "root",
            dependencies: {
              "pkg-a": "file:./pkg-a",
              "pkg-b": "file:./pkg-b",
              "pkg-c": "file:./pkg-c",
            },
          },
        },
        packages: {
          "js-tokens": [
            "js-tokens@4.0.0",
            "",
            {},
            "sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==",
          ],
          "loose-envify": [
            "loose-envify@1.4.0",
            "",
            { "dependencies": { "js-tokens": "^3.0.0 || ^4.0.0" }, "bin": { "loose-envify": "cli.js" } },
            "sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q==",
          ],
          "pkg-a": ["pkg-a@file:pkg-a", { "dependencies": { "pkg-b": "file:../pkg-b" } }],
          "pkg-b": ["pkg-b@file:pkg-b", { "dependencies": { "pkg-c": "file:../pkg-c" } }],
          "pkg-c": ["pkg-c@file:pkg-c", { "dependencies": { "pkg-a": "file:../pkg-a", "react": "^18.0.0" } }],
          "react": [
            "react@18.3.1",
            "",
            { "dependencies": { "loose-envify": "^1.1.0" } },
            "sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==",
          ],
          "pkg-a/pkg-b": ["pkg-b@file:pkg-b", {}],
          "pkg-b/pkg-c": ["pkg-c@file:pkg-c", {}],
          "pkg-c/pkg-a": ["pkg-a@file:pkg-a", {}],
        },
      },
      null,
      2,
    ),
  });

  // Run bun install - this should complete without crashing
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should exit successfully, not crash with segmentation fault
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stdout).toContain("packages installed");
}, 30000); // 30 second timeout
