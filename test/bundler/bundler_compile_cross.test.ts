import { bunEnv } from "harness";
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);
import { CompileTarget } from "bun:internal-for-testing";

describe("bundler", async () => {
  itBundled("compile_cross/DetectDefaultTarget", {
    compile: true,
    target: CompileTarget.getDefaultTarget(),
    env: {
      ...bunEnv,
      BUN_COMPILE_TARGET_TARBALL_URL:
        "https://localhost:999999/deliberately-invalid-url-to-check-that-it-detects-default-target-correctly",
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    run: { stdout: "Hello, world!" },
  });
  itBundled("compile_cross/DetectDefaultTarget2", {
    compile: true,
    target: "bun",
    env: {
      ...bunEnv,
      BUN_COMPILE_TARGET_TARBALL_URL:
        "https://localhost:999999/deliberately-invalid-url-to-check-that-it-detects-default-target-correctly",
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    run: { stdout: "Hello, world!" },
  });
  itBundled("compile_cross/FailOnInvalidTarget", {
    compile: true,
    target: `bun-poop`,
    env: {
      ...bunEnv,
      BUN_COMPILE_TARGET_TARBALL_URL:
        "https://localhost:999999/deliberately-invalid-url-to-check-that-it-detects-default-target-correctly",
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    bundleErrors: {
      "<bun>": [`Unsupported target "poop" in "bun-poop"`],
    },
  });
  itBundled("compile_cross/FailOnWildcardVersion", {
    compile: true,
    target: `bun-v1.*`,
    env: {
      ...bunEnv,
      BUN_COMPILE_TARGET_TARBALL_URL:
        "https://localhost:999999/deliberately-invalid-url-to-check-that-it-detects-default-target-correctly",
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    bundleErrors: {
      "<bun>": [
        `Please pass a complete version number to --target. For example, --target=bun-v` +
          Bun.version.replace("-debug", ""),
      ],
    },
  });
  itBundled("compile_cross/FailsOnInvalidURL", {
    compile: true,
    target: `bun-linux-arm64-v1.0.9999`,
    env: {
      ...bunEnv,
      BUN_COMPILE_TARGET_TARBALL_URL: "https://localhost:999999/deliberately-invalid-url",
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    bundleErrors: {
      "<bun>": [`failed to download cross-compiled bun executable`],
    },
  });

  // we allow using a local file if it has the exact name we expect
  // this is undocumented behavior, but it will make it easier to write tests in the future
  itBundled("compile_cross/UsesFileFromSameLocation", {
    compile: true,
    target: `bun-linux-arm64-v1.999.9999`,
    env: {
      ...bunEnv,
      BUN_COMPILE_TARGET_TARBALL_URL: "https://localhost:999999/deliberately-invalid-url",
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
      // expects "bun" to be trimmed
      [CompileTarget.from("-linux-arm64-v1.999.9999")]: ``,
    },
  });

  // expects "bun" to be trimmed
  const sameLocationTarget = CompileTarget.from(`-${process.platform}-${process.arch}-v1.0.9999`);

  // Test that it can load a file that didn't actually come from bun.selfExePath()
  itBundled("compile_cross/RunsFileFromSameLocation", {
    compile: true,
    target: sameLocationTarget,
    env: {
      ...bunEnv,
      BUN_COMPILE_TARGET_TARBALL_URL: "https://localhost:999999/deliberately-invalid-url",
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,

      ["/" + sameLocationTarget]: Buffer.from(await Bun.file(process.execPath).arrayBuffer()),
    },
    run: {
      stdout: "Hello, world!",
    },
  });
});
