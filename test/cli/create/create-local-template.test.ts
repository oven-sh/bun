import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/36341

function createEnv(templatesDir: string) {
  return {
    ...bunEnv,
    BUN_CREATE_DIR: templatesDir,
    // The conflict path exits via Global::exit; LSan's conservative scan
    // flags in-flight CLI allocations at that point and aborts with 134.
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
  };
}

test.concurrent("bun create from local template preserves unrelated files in destination", async () => {
  using dir = tempDir("create-local-preserve", {
    "templates/mytpl/tpl.txt": "template file",
    "proj/important.txt": "IMPORTANT DATA",
    "proj/subdir/data.txt": "more data",
    // post-copy cleanup must not remove these when the template has no
    // gitignore/.npmignore of its own
    "proj/.npmignore": "my npmignore",
    "proj/gitignore": "file literally named gitignore",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "."],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(await Bun.file(join(String(dir), "proj", "important.txt")).text()).toBe("IMPORTANT DATA");
  expect(await Bun.file(join(String(dir), "proj", "subdir", "data.txt")).text()).toBe("more data");
  expect(await Bun.file(join(String(dir), "proj", "tpl.txt")).text()).toBe("template file");
  expect(await Bun.file(join(String(dir), "proj", ".npmignore")).text()).toBe("my npmignore");
  expect(await Bun.file(join(String(dir), "proj", "gitignore")).text()).toBe("file literally named gitignore");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.not.stringContaining("error") });
});

test.concurrent("bun create from local template refuses to overwrite conflicting files without --force", async () => {
  using dir = tempDir("create-local-conflict", {
    "templates/mytpl/index.ts": "template version",
    "proj/index.ts": "my version",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "."],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(stderr).toContain("index.ts");
  expect(await Bun.file(join(String(dir), "proj", "index.ts")).text()).toBe("my version");
  expect({ exitCode, stderr }).toEqual({
    exitCode: 1,
    stderr: expect.stringContaining("contains files that could conflict"),
  });
});

test.concurrent("bun create from local template overwrites conflicting files with --force", async () => {
  using dir = tempDir("create-local-force", {
    "templates/mytpl/index.ts": "template version",
    "proj/index.ts": "my version",
    "proj/keep.txt": "keep me",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", ".", "--force"],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(await Bun.file(join(String(dir), "proj", "index.ts")).text()).toBe("template version");
  // --force overwrites conflicts but must not delete unrelated files
  expect(await Bun.file(join(String(dir), "proj", "keep.txt")).text()).toBe("keep me");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.not.stringContaining("error") });
});

test.concurrent("bun create from local template into existing named directory preserves its files", async () => {
  using dir = tempDir("create-local-named", {
    "templates/mytpl/tpl.txt": "template file",
    "dest/keep.txt": "keep me",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "dest"],
    env: createEnv(join(String(dir), "templates")),
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(await Bun.file(join(String(dir), "dest", "keep.txt")).text()).toBe("keep me");
  expect(await Bun.file(join(String(dir), "dest", "tpl.txt")).text()).toBe("template file");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.not.stringContaining("error") });
});

test.concurrent("bun create from local template ignores README.md and .gitignore conflicts", async () => {
  using dir = tempDir("create-local-never-conflict", {
    "templates/mytpl/README.md": "template readme",
    "templates/mytpl/.gitignore": "node_modules",
    "templates/mytpl/tpl.txt": "template file",
    "proj/README.md": "my readme",
    "proj/.gitignore": "dist",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "."],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(await Bun.file(join(String(dir), "proj", "tpl.txt")).text()).toBe("template file");
  // never-conflict files are replaced by the template's versions
  expect(await Bun.file(join(String(dir), "proj", "README.md")).text()).toBe("template readme");
  expect(await Bun.file(join(String(dir), "proj", ".gitignore")).text()).toBe("node_modules");
  expect({ exitCode, stderr }).toEqual({
    exitCode: 0,
    stderr: expect.not.stringContaining("contains files that could conflict"),
  });
});

test.concurrent(
  "bun create from local template leaves the user's package.json alone when the template has none",
  async () => {
    const userPackageJson = JSON.stringify({ name: "mine", version: "9.9.9" });
    using dir = tempDir("create-local-pkgjson", {
      "templates/mytpl/tpl.txt": "template file",
      "proj/package.json": userPackageJson,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "create", "mytpl", ".", "--no-install"],
      env: createEnv(join(String(dir), "templates")),
      cwd: join(String(dir), "proj"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

    expect(await Bun.file(join(String(dir), "proj", "package.json")).text()).toBe(userPackageJson);
    expect(await Bun.file(join(String(dir), "proj", "tpl.txt")).text()).toBe("template file");
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.not.stringContaining("error") });
  },
);

test.concurrent("bun create from local template does not run git in a pre-existing repository", async () => {
  using dir = tempDir("create-local-git", {
    "templates/mytpl/tpl.txt": "template file",
    "proj/.git/KEEP.txt": "keep",
    "proj/existing.txt": "user file",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "."],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(await Bun.file(join(String(dir), "proj", ".git", "KEEP.txt")).text()).toBe("keep");
  // git init/add/commit must not have touched the pre-existing repo
  expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: join(String(dir), "proj", ".git"), dot: true }))).toEqual([
    "KEEP.txt",
  ]);
  expect(await Bun.file(join(String(dir), "proj", "tpl.txt")).text()).toBe("template file");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.not.stringContaining("error") });
});

test.concurrent("bun create from local template does not run git when .git is a worktree file", async () => {
  using dir = tempDir("create-local-git-file", {
    "templates/mytpl/tpl.txt": "template file",
    "proj/.git": "gitdir: /somewhere/else/.git/worktrees/proj",
    "proj/existing.txt": "user file",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "."],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  // the worktree pointer file must survive untouched
  expect(await Bun.file(join(String(dir), "proj", ".git")).text()).toBe(
    "gitdir: /somewhere/else/.git/worktrees/proj",
  );
  expect(await Bun.file(join(String(dir), "proj", "tpl.txt")).text()).toBe("template file");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.not.stringContaining("error") });
});

test.concurrent("bun create from local template with --force replaces kind-mismatched entries", async () => {
  using dir = tempDir("create-local-force-mismatch", {
    "templates/mytpl/sub/nested.txt": "template nested",
    "templates/mytpl/blocker": "template blocker file",
    "proj/sub": "file named sub",
    "proj/blocker/inner.txt": "user nested",
    "proj/keep.txt": "keep me",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", ".", "--force"],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(await Bun.file(join(String(dir), "proj", "sub", "nested.txt")).text()).toBe("template nested");
  expect(await Bun.file(join(String(dir), "proj", "blocker")).text()).toBe("template blocker file");
  expect(await Bun.file(join(String(dir), "proj", "keep.txt")).text()).toBe("keep me");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.not.stringContaining("error") });
});

test.concurrent("bun create from local template refuses when a template directory collides with a file", async () => {
  using dir = tempDir("create-local-dir-conflict", {
    "templates/mytpl/sub/nested.txt": "template nested",
    "proj/sub": "I am a file named sub",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "."],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

  expect(stderr).toContain("sub");
  expect(await Bun.file(join(String(dir), "proj", "sub")).text()).toBe("I am a file named sub");
  expect({ exitCode, stderr }).toEqual({
    exitCode: 1,
    stderr: expect.stringContaining("contains files that could conflict"),
  });
});
