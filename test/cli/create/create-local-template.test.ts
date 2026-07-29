import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/36341
// `bun create <local-template> <dest>` used to `rm -rf` the destination
// before copying, silently destroying pre-existing files (including the
// entire cwd when dest was "."). It must preserve unrelated files and
// refuse to overwrite conflicting ones unless --force is passed.

function createEnv(templatesDir: string) {
  return { ...bunEnv, BUN_CREATE_DIR: templatesDir };
}

test.concurrent("bun create from local template preserves unrelated files in destination", async () => {
  using dir = tempDir("create-local-preserve", {
    "templates/mytpl/tpl.txt": "template file",
    "proj/important.txt": "IMPORTANT DATA",
    "proj/subdir/data.txt": "more data",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "mytpl", "."],
    env: createEnv(join(String(dir), "templates")),
    cwd: join(String(dir), "proj"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(await Bun.file(join(String(dir), "proj", "important.txt")).text()).toBe("IMPORTANT DATA");
  expect(await Bun.file(join(String(dir), "proj", "subdir", "data.txt")).text()).toBe("more data");
  expect(await Bun.file(join(String(dir), "proj", "tpl.txt")).text()).toBe("template file");
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
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
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("contains files that could conflict");
  expect(stderr).toContain("index.ts");
  expect(await Bun.file(join(String(dir), "proj", "index.ts")).text()).toBe("my version");
  expect(exitCode).toBe(1);
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
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(await Bun.file(join(String(dir), "proj", "index.ts")).text()).toBe("template version");
  // --force overwrites conflicts but must not delete unrelated files
  expect(await Bun.file(join(String(dir), "proj", "keep.txt")).text()).toBe("keep me");
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
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
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(await Bun.file(join(String(dir), "dest", "keep.txt")).text()).toBe("keep me");
  expect(await Bun.file(join(String(dir), "dest", "tpl.txt")).text()).toBe("template file");
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
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
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("contains files that could conflict");
  expect(await Bun.file(join(String(dir), "proj", "tpl.txt")).text()).toBe("template file");
  expect(exitCode).toBe(0);
});
