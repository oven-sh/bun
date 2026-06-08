import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  package_dir,
  root_url,
  setHandler,
} from "../../cli/install/dummy.registry";

// Test for GitHub issue #26046
// `bun pm ls` fails with `error: Error loading lockfile: InvalidPackageInfo`
// when a package has required (non-optional) peer dependencies that are not installed.
//
// The fix: when writing a lockfile, unresolved required peer dependencies are
// added to `optionalPeers` so the lockfile can be loaded without errors.

setDefaultTimeout(1000 * 60 * 5);
beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
afterEach(dummyAfterEach);

test("bun pm ls works after installing package with unresolved required peer dep", async () => {
  await dummyBeforeEach();

  const dir = package_dir;

  // Write bunfig with text lockfile enabled
  await Bun.write(
    join(dir, "bunfig.toml"),
    `[install]\ncache = false\nregistry = "${root_url}"\nsaveTextLockfile = true\n`,
  );

  // Custom handler: serves "has-unresolved-peer" with a required peer dep
  // on "nonexistent-peer@>=99.0.0". The registry only has v1.0.0 of nonexistent-peer,
  // so the peer dep can't be satisfied and stays unresolved.
  setHandler(async request => {
    const url = request.url;
    if (url.endsWith(".tgz")) {
      if (url.includes("has-unresolved-peer")) {
        return new Response(
          Bun.file(join(import.meta.dir, "..", "..", "cli", "install", "has-unresolved-peer-1.0.0.tgz")),
        );
      }
      return new Response("not found", { status: 404 });
    }

    const name = new URL(url).pathname.slice(1);

    if (name === "has-unresolved-peer") {
      return new Response(
        JSON.stringify({
          name: "has-unresolved-peer",
          versions: {
            "1.0.0": {
              name: "has-unresolved-peer",
              version: "1.0.0",
              peerDependencies: { "nonexistent-peer": ">=99.0.0" },
              dist: { tarball: `${root_url}/has-unresolved-peer-1.0.0.tgz` },
            },
          },
          "dist-tags": { latest: "1.0.0" },
        }),
      );
    }

    if (name === "nonexistent-peer") {
      return new Response(
        JSON.stringify({
          name: "nonexistent-peer",
          versions: {
            "1.0.0": {
              name: "nonexistent-peer",
              version: "1.0.0",
              dist: { tarball: `${root_url}/nonexistent-peer-1.0.0.tgz` },
            },
          },
          "dist-tags": { latest: "1.0.0" },
        }),
      );
    }

    return new Response("not found", { status: 404 });
  });

  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify({
      name: "test-issue-26046",
      dependencies: { "has-unresolved-peer": "1.0.0" },
    }),
  );

  // Install - nonexistent-peer can't satisfy >=99.0.0 so stays unresolved
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Verify the generated bun.lock includes optionalPeers for the unresolved peer
  const lockContent = await Bun.file(join(dir, "bun.lock")).text();
  expect(lockContent).toContain("optionalPeers");
  expect(lockContent).toContain("nonexistent-peer");

  // The critical check: bun pm ls must not fail with InvalidPackageInfo
  await using lsProc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [lsStdout, lsStderr, lsExitCode] = await Promise.all([
    lsProc.stdout.text(),
    lsProc.stderr.text(),
    lsProc.exited,
  ]);

  expect(lsStderr).not.toContain("InvalidPackageInfo");
  expect(lsStdout).toContain("has-unresolved-peer");
  expect(lsExitCode).toBe(0);
});
