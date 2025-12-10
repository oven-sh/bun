import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun link <package> within workspace that depends on sibling workspace", async () => {
  using dir = tempDir("bun-link-workspace", {
    "work/package.json": JSON.stringify({ workspaces: ["foo", "bar"] }),
    "work/foo/package.json": JSON.stringify({ name: "foo", dependencies: { bar: "workspace:*" } }),
    "work/bar/package.json": JSON.stringify({ name: "bar" }),
    "dep/package.json": JSON.stringify({ name: "dep" }),
  });

  // First, run `bun install` in the workspace root to set up the workspace
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: `${dir}/work`,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [installStdout, installStderr, installExitCode] = await Promise.all([
    installProc.stdout.text(),
    installProc.stderr.text(),
    installProc.exited,
  ]);

  expect(installExitCode).toBe(0);

  // Register the dep package as a linked package
  await using linkProc = Bun.spawn({
    cmd: [bunExe(), "link"],
    cwd: `${dir}/dep`,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [linkStdout, linkStderr, linkExitCode] = await Promise.all([
    linkProc.stdout.text(),
    linkProc.stderr.text(),
    linkProc.exited,
  ]);

  expect(linkStderr).not.toContain("Workspace dependency");
  expect(linkStderr).not.toContain("not found");
  expect(linkExitCode).toBe(0);

  // Now try to link the dep package from within the foo workspace
  // This should not fail with "Workspace dependency 'bar' not found"
  await using linkDepProc = Bun.spawn({
    cmd: [bunExe(), "link", "dep"],
    cwd: `${dir}/work/foo`,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [linkDepStdout, linkDepStderr, linkDepExitCode] = await Promise.all([
    linkDepProc.stdout.text(),
    linkDepProc.stderr.text(),
    linkDepProc.exited,
  ]);

  expect(linkDepStderr).not.toContain("Workspace dependency");
  expect(linkDepStderr).not.toContain("not found");
  expect(linkDepExitCode).toBe(0);
});
