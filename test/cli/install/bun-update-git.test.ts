import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { bunExe, bunEnv as env, tempDirWithFiles } from "harness";
import { join } from "path";
import { dummyAfterAll, dummyBeforeAll } from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

it("bun update --force updates git dependencies", async () => {
  // Setup remote git repo
  const remoteDir = tempDirWithFiles("remote-git-repo", {
    "package.json": JSON.stringify({ name: "my-git-dep", version: "1.0.0" }),
    "index.js": "console.log('v1');",
  });

  let exitCode = await spawn({ cmd: ["git", "init"], cwd: remoteDir }).exited;
  if (exitCode !== 0) throw new Error(`git init failed with exit code ${exitCode}`);
  
  exitCode = await spawn({ cmd: ["git", "config", "user.name", "Bun Test"], cwd: remoteDir }).exited;
  if (exitCode !== 0) throw new Error(`git config user.name failed with exit code ${exitCode}`);
  
  exitCode = await spawn({ cmd: ["git", "config", "user.email", "test@bun.sh"], cwd: remoteDir }).exited;
  if (exitCode !== 0) throw new Error(`git config user.email failed with exit code ${exitCode}`);
  
  exitCode = await spawn({ cmd: ["git", "add", "."], cwd: remoteDir }).exited;
  if (exitCode !== 0) throw new Error(`git add . failed with exit code ${exitCode}`);
  
  exitCode = await spawn({ cmd: ["git", "commit", "-m", "v1"], cwd: remoteDir }).exited;
  if (exitCode !== 0) throw new Error(`git commit failed with exit code ${exitCode}`);

  // Setup local project
  const localDir = tempDirWithFiles("local-project", {
    "package.json": JSON.stringify({
      name: "my-app",
      dependencies: {
        "my-git-dep": `git+file://${remoteDir}`,
      },
    }),
  });

  // Install v1
  const { exited: installExited, stderr: installStderr } = spawn({ cmd: [bunExe(), "install"], cwd: localDir, env, stderr: "pipe" });
  const installErr = await new Response(installStderr).text();
  const installExitCode = await installExited;
  if (installExitCode !== 0) {
    console.error(installErr);
  }
  expect(installExitCode).toBe(0);

  // Verify v1 installed
  const v1Pkg = await Bun.file(join(localDir, "node_modules", "my-git-dep", "package.json")).json();
  expect(v1Pkg.version).toBe("1.0.0");

  // Update remote to v2
  await writeFile(join(remoteDir, "package.json"), JSON.stringify({ name: "my-git-dep", version: "2.0.0" }));
  await writeFile(join(remoteDir, "index.js"), "console.log('v2');");
  
  exitCode = await spawn({ cmd: ["git", "add", "."], cwd: remoteDir }).exited;
  if (exitCode !== 0) throw new Error(`git add . (v2) failed with exit code ${exitCode}`);
  
  exitCode = await spawn({ cmd: ["git", "commit", "-m", "v2"], cwd: remoteDir }).exited;
  if (exitCode !== 0) throw new Error(`git commit (v2) failed with exit code ${exitCode}`);

  // Run bun update --force
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", "--force"],
    cwd: localDir,
    env,
    stdout: "pipe",
    stderr: "pipe"
  });

  const err = await new Response(stderr).text();
  const updateExitCode = await exited;
  if (updateExitCode !== 0) {
    console.error(err);
  }
  expect(updateExitCode).toBe(0);

  // Verify v2 installed
  const v2Pkg = await Bun.file(join(localDir, "node_modules", "my-git-dep", "package.json")).json();
  expect(v2Pkg.version).toBe("2.0.0");
});
