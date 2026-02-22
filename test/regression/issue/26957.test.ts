import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { writeFile } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { basename, join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  package_dir,
  root_url,
  setHandler,
} from "../../cli/install/dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach({ linker: "hoisted" });
});
afterEach(dummyAfterEach);

it("should deduplicate 'Skip installing' verbose messages for os/cpu mismatch", async () => {
  // Custom handler that returns different metadata per package:
  // - pkg-a and pkg-b are normal packages that depend on os-restricted-dep
  // - os-restricted-dep has os: ["darwin"], so it will be skipped on non-darwin
  setHandler(async request => {
    const url = request.url.replaceAll("%2f", "/");
    if (url.endsWith(".tgz")) {
      return new Response(Bun.file(join(import.meta.dir, "../../cli/install", basename(url).toLowerCase())));
    }
    expect(request.method).toBe("GET");

    const name = url.slice(url.indexOf("/", root_url.length) + 1);

    if (name === "os-restricted-dep") {
      return new Response(
        JSON.stringify({
          name: "os-restricted-dep",
          versions: {
            "1.0.0": {
              name: "os-restricted-dep",
              version: "1.0.0",
              os: ["darwin"],
              dist: { tarball: `${root_url}/os-restricted-dep-1.0.0.tgz` },
            },
          },
          "dist-tags": { latest: "1.0.0" },
        }),
      );
    }

    // For pkg-a and pkg-b: they both optionally depend on os-restricted-dep
    return new Response(
      JSON.stringify({
        name,
        versions: {
          "1.0.0": {
            name,
            version: "1.0.0",
            optionalDependencies: {
              "os-restricted-dep": "1.0.0",
            },
            dist: { tarball: `${root_url}/${name}-1.0.0.tgz` },
          },
        },
        "dist-tags": { latest: "1.0.0" },
      }),
    );
  });

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-dedup-skip-messages",
      version: "1.0.0",
      dependencies: {
        "pkg-a": "1.0.0",
        "pkg-b": "1.0.0",
      },
    }),
  );

  // Install with --os linux --verbose to trigger "Skip installing" for the darwin-only dep
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--os", "linux", "--verbose"],
    cwd: package_dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

  const combined = stdoutText + stderrText;
  const skipMessages = combined.split("\n").filter((line: string) => line.includes("Skip installing"));

  // The "Skip installing os-restricted-dep" message should appear exactly once,
  // not once per parent that depends on it.
  expect(skipMessages.length).toBe(1);
  expect(skipMessages[0]).toContain("os-restricted-dep");
  expect(skipMessages[0]).toContain("os mismatch");

  expect(exitCode).toBe(0);
});
