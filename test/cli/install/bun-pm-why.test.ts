import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

it("should explain direct dependency with bun pm why", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "latest",
      },
    }),
  );

  // Install dependencies first
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await new Response(stderr).text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }

  // Test bun pm why
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "why", "bar"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const output = await new Response(stdout).text();
    expect(await new Response(stderr).text()).toBe("");
    expect(output).toContain("bar@0.0.2");
    expect(output).toContain("from the root project");
    expect(await exited).toBe(0);
  }
});

it("should explain transitive dependency with bun pm why", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));

  // Create a nested dependency structure
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

  // Install dependencies first
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await new Response(stderr).text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }

  // Test bun pm why on the transitive dependency
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "why", "bar"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const output = await new Response(stdout).text();
    expect(await new Response(stderr).text()).toBe("");
    expect(output).toContain("bar@0.0.2");
    expect(output).toContain("from moo@");
    expect(await exited).toBe(0);
  }
});

it("should return error for non-existent package", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "latest",
      },
    }),
  );

  // Install dependencies first
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await new Response(stderr).text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }

  // Test bun pm why with a non-existent package
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "why", "non-existent-package"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const errOutput = await new Response(stderr).text();
    expect(errOutput).toContain("error");
    expect(errOutput).toContain("package 'non-existent-package' not found");
    expect(await exited).toBe(0); // The command itself returns 0 even on not found
  }
});

it("should output JSON format when --json flag is specified", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "latest",
      },
    }),
  );

  // Install dependencies first
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await new Response(stderr).text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }

  // Test bun pm why with JSON output
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "why", "--json", "bar"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const output = await new Response(stdout).text();
    expect(await new Response(stderr).text()).toBe("");

    // Parse the JSON to verify it's valid
    const json = JSON.parse(output);
    expect(json).toHaveProperty("dependencies");
    expect(json.dependencies.length).toBe(1);
    expect(json.dependencies[0].name).toBe("bar");
    expect(json.dependencies[0].version).toBe("0.0.2");
    expect(json.dependencies[0]).toHaveProperty("dependencyChain");
    expect(json.dependencies[0].dependencyChain.length).toBe(1);
    expect(json.dependencies[0].dependencyChain[0].from).toBe("root");

    expect(await exited).toBe(0);
  }

  // Test JSON output with non-existent package
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "why", "--json", "non-existent-package"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const output = await new Response(stdout).text();
    expect(await new Response(stderr).text()).toBe("");

    // Parse the JSON to verify it's valid
    const json = JSON.parse(output);
    expect(json).toHaveProperty("error");
    expect(json.error).toBe("package not found");

    expect(await exited).toBe(0);
  }
});
