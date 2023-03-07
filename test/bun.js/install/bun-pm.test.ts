import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe } from "bunExe";
import { bunEnv as env } from "bunEnv";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

it("should list top-level dependency", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );
  expect(
    await spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }).exited,
  ).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  expect(await new Response(stderr).text()).toBe("");
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe(`${package_dir} node_modules (2)
└── moo@moo
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});

it("should list all dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );
  expect(
    await spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }).exited,
  ).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--all"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  expect(await new Response(stderr).text()).toBe("");
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe(`${package_dir} node_modules
├── bar@0.0.2
└── moo@moo
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});

it("should list top-level aliased dependency", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "moo-1": "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        "bar-1": "npm:bar",
      },
    }),
  );
  expect(
    await spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }).exited,
  ).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  expect(await new Response(stderr).text()).toBe("");
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe(`${package_dir} node_modules (2)
└── moo-1@moo
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});

it("should list aliased dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "moo-1": "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        "bar-1": "npm:bar",
      },
    }),
  );
  expect(
    await spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }).exited,
  ).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--all"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  expect(await new Response(stderr).text()).toBe("");
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe(`${package_dir} node_modules
└── moo-1@moo
    └── bar-1@0.0.2
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});
