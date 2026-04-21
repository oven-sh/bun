import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  root_url,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

it("should list only linked packages with --link", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  const dir = tmpdirSync();

  // Setup workspace
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
    }),
  );
  await mkdir(join(dir, "packages", "a"), { recursive: true });
  await writeFile(
    join(dir, "packages", "a", "package.json"),
    JSON.stringify({
      name: "a",
      version: "1.0.0",
    }),
  );
  await mkdir(join(dir, "packages", "b"), { recursive: true });
  await writeFile(
    join(dir, "packages", "b", "package.json"),
    JSON.stringify({
      name: "b",
      version: "1.0.0",
      dependencies: {
        a: "workspace:*",
      },
    }),
  );
  await mkdir(join(dir, "packages", "c"), { recursive: true });
  await writeFile(
    join(dir, "packages", "c", "package.json"),
    JSON.stringify({
      name: "c",
      version: "1.0.0",
      dependencies: {
        b: "workspace:*",
        "lodash": "latest",
      },
    }),
  );

  // Install
  {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(await exited).toBe(0);
  }

  // Run bun pm ls --link in packages/c
  const cwd = join(dir, "packages", "c");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--link"],
    cwd,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await stderr.text()).toBe("");
  const output = await stdout.text();

  // Should contain 'b'
  expect(output).toContain("b@workspace:");
  // Should NOT contain 'lodash'
  expect(output).not.toContain("lodash");
  expect(await exited).toBe(0);
});

it("should list only linked packages with --link --all", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  const dir = tmpdirSync();

  // Setup workspace
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
    }),
  );
  await mkdir(join(dir, "packages", "a"), { recursive: true });
  await writeFile(
    join(dir, "packages", "a", "package.json"),
    JSON.stringify({
      name: "a",
      version: "1.0.0",
    }),
  );
  await mkdir(join(dir, "packages", "b"), { recursive: true });
  await writeFile(
    join(dir, "packages", "b", "package.json"),
    JSON.stringify({
      name: "b",
      version: "1.0.0",
      dependencies: {
        a: "workspace:*",
      },
    }),
  );
  await mkdir(join(dir, "packages", "c"), { recursive: true });
  await writeFile(
    join(dir, "packages", "c", "package.json"),
    JSON.stringify({
      name: "c",
      version: "1.0.0",
      dependencies: {
        b: "workspace:*",
        "lodash": "latest",
      },
    }),
  );

  // Install
  {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(await exited).toBe(0);
  }

  // Run bun pm ls --link --all in packages/c
  const cwd = join(dir, "packages", "c");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--link", "--all"],
    cwd,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await stderr.text()).toBe("");
  const output = await stdout.text();

  // Should contain 'b' and 'a'
  expect(output).toContain("b@workspace:");
  expect(output).toContain("a@workspace:");
  // Should NOT contain 'lodash'
  expect(output).not.toContain("lodash");
  expect(await exited).toBe(0);
});
