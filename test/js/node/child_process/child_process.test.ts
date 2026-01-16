import { semver, which, write } from "bun";
import { afterAll, beforeEach, describe, expect, it, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, nodeExe, runBunInstall, shellExe, tmpdirSync } from "harness";
import { ChildProcess, exec, execFile, execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import path from "path";
const debug = process.env.DEBUG ? console.log : () => {};

const originalProcessEnv = process.env;
beforeEach(() => {
  process.env = { ...bunEnv };
  // Github actions might filter these out
  for (const key in process.env) {
    if (key.toUpperCase().startsWith("TLS_")) {
      delete process.env[key];
    }
  }
});

afterAll(() => {
  process.env = originalProcessEnv;
});

function isValidSemver(string: string): boolean {
  const cmp = string.replaceAll("-debug", "").trim();
  const valid = semver.satisfies(cmp, "*");

  if (!valid) {
    console.error(`Invalid semver: ${JSON.stringify(cmp)}`);
  }

  return valid;
}

describe("ChildProcess.spawn()", () => {
  it("should emit `spawn` on spawn", async () => {
    const proc = new ChildProcess();
    const result = await new Promise(resolve => {
      proc.on("spawn", () => {
        resolve(true);
      });
      // @ts-ignore
      proc.spawn({ file: bunExe(), args: [bunExe(), "-v"] });
    });
    expect(result).toBe(true);
  });

  it("should emit `exit` when killed", async () => {
    const proc = new ChildProcess();
    const result = await new Promise(resolve => {
      proc.on("exit", () => {
        resolve(true);
      });
      // @ts-ignore
      proc.spawn({ file: bunExe(), args: [bunExe(), "-v"] });
      proc.kill();
    });
    expect(result).toBe(true);
  });
});

describe("spawn()", () => {
  it("should spawn a process", () => {
    const child = spawn("bun", ["-v"]);
    expect(!!child).toBe(true);
  });

  it("should use cwd from options to search for executables", async () => {
    const tmpdir = tmpdirSync();
    await Promise.all([
      write(
        path.join(tmpdir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            foo: "file:foo-1.2.3.tgz",
          },
        }),
      ),
      fs.promises.cp(path.join(import.meta.dir, "fixtures", "foo-1.2.3.tgz"), path.join(tmpdir, "foo-1.2.3.tgz")),
    ]);
    await runBunInstall(bunEnv, tmpdir);

    console.error({ tmpdir });
    const { exitCode, out } = await new Promise<any>(resolve => {
      const child = spawn("./node_modules/.bin/foo", { cwd: tmpdir, env: bunEnv });
      child.on("exit", async exitCode => {
        const out = await new Response(child.stdout).text();
        resolve({ exitCode, out });
      });
    });
    expect(out).toBe("hello bun!\n");
    expect(exitCode).toBe(0);
  });

  it("should disallow invalid filename", () => {
    // @ts-ignore
    expect(() => spawn(123)).toThrow({
      message: 'The "file" argument must be of type string. Received type number (123)',
      code: "ERR_INVALID_ARG_TYPE",
    });
  });

  it("should allow stdout to be read via Node stream.Readable `data` events", async () => {
    const child = spawn(bunExe(), ["-v"]);
    const result: string = await new Promise(resolve => {
      child.stdout.on("error", e => {
        console.error(e);
      });
      child.stdout.on("data", data => {
        debug(`stdout: ${data}`);
        resolve(data.toString());
      });
      child.stderr.on("data", data => {
        debug(`stderr: ${data}`);
      });
    });
    expect(isValidSemver(result.trim().replace("-debug", ""))).toBe(true);
  });

  it("should allow stdout to be read via .read() API", async () => {
    const child = spawn(bunExe(), ["-v"]);
    const result: string = await new Promise((resolve, reject) => {
      let finalData = "";
      child.stdout.on("error", e => {
        reject(e);
      });
      child.stdout.on("readable", () => {
        let data;

        while ((data = child.stdout.read()) !== null) {
          finalData += data.toString();
        }
        resolve(finalData);
      });
    });
    expect(isValidSemver(result.trim())).toBe(true);
  });

  it("should accept stdio option with 'ignore' for no stdio fds", async () => {
    const child1 = spawn(bunExe(), ["-v"], {
      stdio: "ignore",
    });
    const child2 = spawn(bunExe(), ["-v"], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    expect(!!child1).toBe(true);
    expect(child1.stdin).toBe(null);
    expect(child1.stdout).toBe(null);
    expect(child1.stderr).toBe(null);

    expect(!!child2).toBe(true);
    expect(child2.stdin).toBe(null);
    expect(child2.stdout).toBe(null);
    expect(child2.stderr).toBe(null);
  });

  it("should allow us to set cwd", async () => {
    const tmpdir = tmpdirSync();
    const result: string = await new Promise(resolve => {
      const child = spawn(bunExe(), ["-e", "console.log(process.cwd())"], { cwd: tmpdir, env: bunEnv });
      child.stdout.on("data", data => {
        resolve(data.toString());
      });
    });
    expect(result.trim()).toBe(tmpdir);
  });

  it("should allow us to write to stdin", async () => {
    const result: string = await new Promise(resolve => {
      const child = spawn(bunExe(), ["-e", "process.stdin.pipe(process.stdout)"], { env: bunEnv });
      child.stdin.write("hello");
      child.stdout.on("data", data => {
        resolve(data.toString());
      });
    });
    expect(result.trim()).toBe("hello");
  });

  it("should allow us to timeout hanging processes", async () => {
    const child = spawn(shellExe(), ["-c", "sleep", "2"], { timeout: 3 });
    const start = performance.now();
    let end: number;
    await new Promise(resolve => {
      child.on("exit", () => {
        end = performance.now();
        resolve(true);
      });
    });
    expect(end!).toBeDefined();
    expect(end! - start < 2000).toBe(true);
  });

  it("should allow us to set env", async () => {
    async function getChildEnv(env: any): Promise<object> {
      const result: string = await new Promise(resolve => {
        const child = spawn(bunExe(), ["-e", "process.stderr.write(JSON.stringify(process.env))"], { env });
        child.stderr.on("data", data => {
          resolve(data.toString());
        });
      });
      return JSON.parse(result);
    }

    // on Windows, there's a set of environment variables which are always set
    if (isWindows) {
      expect(await getChildEnv({ TEST: "test" })).toMatchObject({ TEST: "test" });
      expect(await getChildEnv({})).toMatchObject({});
      expect(await getChildEnv(undefined)).not.toStrictEqual({});
      expect(await getChildEnv(null)).not.toStrictEqual({});
    } else {
      expect(await getChildEnv({ TEST: "test" })).toStrictEqual({ TEST: "test" });
      expect(await getChildEnv({})).toStrictEqual({});
      expect(await getChildEnv(undefined)).toStrictEqual(process.env);
      expect(await getChildEnv(null)).toStrictEqual(process.env);
    }
  });

  it("should allow explicit setting of argv0", async () => {
    var resolve: (_?: any) => void;
    const promise = new Promise<string>(resolve1 => {
      resolve = resolve1;
    });
    process.env.NO_COLOR = "1";
    const node = nodeExe();
    const bun = bunExe();
    const child = spawn(
      node || bun,
      ["-e", "console.log(JSON.stringify([process.argv0, fs.realpathSync(process.argv[0])]))"],
      {
        argv0: bun,
        stdio: ["inherit", "pipe", "inherit"],
        env: bunEnv,
      },
    );
    delete process.env.NO_COLOR;
    let msg = "";

    child.stdout.on("data", data => {
      msg += data.toString();
    });

    child.stdout.on("close", () => {
      resolve(msg);
    });

    const result = await promise;
    expect(JSON.parse(result)).toStrictEqual([bun, fs.realpathSync(node || bun)]);
  });

  it("should allow us to spawn in the default shell", async () => {
    const shellPath: string = await new Promise(resolve => {
      const child = spawn("echo", [isWindows ? "$PSHOME" : "$SHELL"], { shell: true });
      child.stdout.on("data", data => {
        resolve(data.toString().trim());
      });
    });

    // On Windows, the default shell is cmd.exe, which does not support this
    if (isWindows) {
      expect(shellPath).not.toBeEmpty();
    } else {
      expect(fs.existsSync(shellPath), `${shellPath} does not exist`).toBe(true);
    }
  });

  it("should allow us to spawn in a specified shell", async () => {
    const shell = shellExe();
    const shellPath: string = await new Promise(resolve => {
      const child = spawn("echo", [isWindows ? "$PSHOME" : "$SHELL"], { shell });
      child.stdout.on("data", data => {
        resolve(data.toString().trim());
      });
    });
    expect(fs.existsSync(shellPath), `${shellPath} does not exist`).toBe(true);
  });

  it("should spawn a process synchronously", () => {
    const { stdout } = spawnSync("bun", ["-v"], { encoding: "utf8" });
    expect(isValidSemver(stdout.trim())).toBe(true);
  });

  describe("stdio", () => {
    it("ignore", () => {
      const child = spawn(bunExe(), ["-v"], { stdio: "ignore" });
      expect(!!child).toBe(true);
      expect(child.stdout).toBeNull();
      expect(child.stderr).toBeNull();
    });
    it("inherit", () => {
      const child = spawn(bunExe(), ["-v"], { stdio: "inherit" });
      expect(!!child).toBe(true);
      expect(child.stdout).toBeNull();
      expect(child.stderr).toBeNull();
    });
    it("pipe", () => {
      const child = spawn(bunExe(), ["-v"], { stdio: "pipe" });
      expect(!!child).toBe(true);
      expect(child.stdout).not.toBeNull();
      expect(child.stderr).not.toBeNull();
    });
    it.todo("overlapped", () => {
      const child = spawn(bunExe(), ["-v"], { stdio: "overlapped" });
      expect(!!child).toBe(true);
      expect(child.stdout).not.toBeNull();
      expect(child.stderr).not.toBeNull();
    });
  });
});

describe("execFile()", () => {
  it("should execute a file", async () => {
    const result: Buffer = await new Promise((resolve, reject) => {
      execFile(bunExe(), ["-v"], { encoding: "buffer" }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });
    expect(isValidSemver(result.toString().trim())).toBe(true);
  });
});

describe("exec()", () => {
  it("should execute a command in a shell", async () => {
    const result: Buffer = await new Promise((resolve, reject) => {
      exec("bun -v", { encoding: "buffer" }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });
    expect(isValidSemver(result.toString().trim())).toBe(true);
  });

  it("should return an object w/ stdout and stderr when promisified", async () => {
    const result = await promisify(exec)("bun -v");
    expect(typeof result).toBe("object");
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");

    const { stdout, stderr } = result;
    expect(isValidSemver(stdout.trim())).toBe(true);
    expect(stderr.trim()).toBe("");
  });
});

describe("spawnSync()", () => {
  it("should spawn a process synchronously", () => {
    const { stdout } = spawnSync("bun", ["-v"], { encoding: "utf8" });
    expect(isValidSemver(stdout.trim())).toBe(true);
  });
});

describe("execFileSync()", () => {
  it("should execute a file synchronously", () => {
    const result = execFileSync(bunExe(), ["-v"], { encoding: "utf8", env: process.env });
    expect(isValidSemver(result.trim())).toBe(true);
  });

  it("should allow us to pass input to the command", () => {
    const result = execFileSync("node", [import.meta.dir + "/spawned-child.js", "STDIN"], {
      input: "hello world!",
      encoding: "utf8",
      env: process.env,
    });
    expect(result.trim()).toBe("data: hello world!");
  });
});

describe("execSync()", () => {
  it("should execute a command in the shell synchronously", () => {
    const result = execSync(bunExe() + " -v", { encoding: "utf8", env: bunEnv });
    expect(isValidSemver(result.trim())).toBe(true);
  });
});

it("should call close and exit before process exits", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), path.join("fixtures", "child-process-exit-event.js")],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "inherit",
  });
  const data = await proc.stdout.text();
  expect(data).toContain("closeHandler called");
  expect(data).toContain("exithHandler called");
  expect(await proc.exited).toBe(0);
});

it("it accepts stdio passthrough", async () => {
  const package_dir = tmpdirSync();

  await fs.promises.writeFile(
    path.join(package_dir, "package.json"),
    JSON.stringify({
      "name": "npm-run-all-test",
      "version": "1.0.0",
      "type": "module",
      "scripts": {
        "all": "run-p echo-hello echo-world",
        "echo-hello": "echo hello",
        "echo-world": "echo world",
      },
      "devDependencies": {
        "npm-run-all": "4.1.5",
      },
    }),
  );

  let { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdio: ["inherit", "inherit", "inherit"],
    env: bunEnv,
  });
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "--bun", "run", "all"],
    cwd: package_dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  }));
  console.log(package_dir);
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  try {
    // This command outputs in either `["hello", "world"]` or `["world", "hello"]` order.
    console.log({ err, out });
    expect([err.split("\n")[0], ...err.split("\n").slice(1, -1).sort(), err.split("\n").at(-1)]).toEqual([
      "$ run-p echo-hello echo-world",
      "$ echo hello",
      "$ echo world",
      "",
    ]);
    expect(out.split("\n").slice(0, -1).sort()).toStrictEqual(["hello", "world"].sort());
    expect(exitCode).toBe(0);
  } catch (e) {
    console.error({ exitCode });
    console.log(err);
    console.log(out);
    throw e;
  }
}, 10000);

it.if(!isWindows)("spawnSync correctly reports signal codes", () => {
  const trapCode = `
    process.kill(process.pid, "SIGTRAP");
  `;

  const { signal } = spawnSync(bunExe(), ["-e", trapCode], {
    // @ts-expect-error
    env: { ...bunEnv, BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF: "1" },
  });

  expect(signal).toBe("SIGTRAP");
});

it("spawnSync(does-not-exist)", () => {
  const x = spawnSync("does-not-exist");
  expect(x.error?.code).toEqual("ENOENT");
  expect(x.error.path).toEqual("does-not-exist");
  expect(x.signal).toEqual(null);
  expect(x.output).toEqual([null, null, null]);
  expect(x.stdout).toEqual(null);
  expect(x.stderr).toEqual(null);
});

// Regression test for #8095
test.each([null, undefined])("spawnSync can pass %p as option to stdio", input => {
  const { stdout, stderr, output } = spawnSync(bunExe(), { stdio: [input, input, input] });
  expect(stdout).toBeInstanceOf(Buffer);
  expect(stderr).toBeInstanceOf(Buffer);
  expect(output).toStrictEqual([null, stdout, stderr]);
});

// Regression test for #8095
test.each([null, undefined])("spawn can pass %p as option to stdio", input => {
  const { stdout, stderr, stdio } = spawn(bunExe(), { stdio: [input, input, input] });
  expect(stdout).toBeInstanceOf(Readable);
  expect(stderr).toBeInstanceOf(Readable);
  expect(stdio).toBeArrayOfSize(3);
  expect(stdio.slice(1)).toStrictEqual([stdout, stderr]);
});

// Regression test for #9279
test.if(!!which("sleep"))("child_process.spawn({ timeout }) should not exit instantly", async () => {
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sleep", ["1000"], { timeout: 100 });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  const end = performance.now();
  expect(end - start).toBeGreaterThanOrEqual(100);
});

// Regression test for #10170
test("promisified execFile returns object with stdout and stderr", async () => {
  const execFileAsync = promisify(execFile);
  const result = await execFileAsync(bunExe(), ["--version"]);
  expect(result.stdout).toContain(Bun.version);
  expect(result.stderr).toBe("");
});

// Regression test for https://github.com/microlinkhq/youtube-dl-exec/issues/246
describe("child process stdio properties should be enumerable for Object.assign()", () => {
  test("child process stdio properties should be enumerable for Object.assign()", () => {
    const child = spawn(process.execPath, ["-e", 'console.log("hello")']);

    // The real issue: stdio properties must be enumerable for Object.assign() to work
    // This is what libraries like tinyspawn depend on
    expect(Object.keys(child)).toContain("stdin");
    expect(Object.keys(child)).toContain("stdout");
    expect(Object.keys(child)).toContain("stderr");
    expect(Object.keys(child)).toContain("stdio");

    // Property descriptors should show enumerable: true
    for (const key of ["stdin", "stdout", "stderr", "stdio"] as const) {
      expect(Object.getOwnPropertyDescriptor(child, key)?.enumerable).toBe(true);
    }
  });

  test("Object.assign should copy child process stdio properties", () => {
    const child = spawn(process.execPath, ["-e", 'console.log("hello")']);

    // This is what tinyspawn does: Object.assign(promise, childProcess)
    const merged: any = {};
    Object.assign(merged, child);

    // The merged object should have the stdio properties
    expect(merged.stdout).toBeTruthy();
    expect(merged.stderr).toBeTruthy();
    expect(merged.stdin).toBeTruthy();
    expect(merged.stdio).toBeTruthy();

    // Should maintain stream functionality
    expect(typeof merged.stdout.pipe).toBe("function");
    expect(typeof merged.stdout.on).toBe("function");
  });

  test("tinyspawn-like library usage should work", () => {
    // Simulate the exact pattern from tinyspawn library
    let childProcess: any;
    const promise = new Promise(resolve => {
      childProcess = spawn(process.execPath, ["-e", 'console.log("test")']);
      childProcess.on("exit", () => resolve(childProcess));
    });

    // This is the critical line that was failing in Bun
    const subprocess: any = Object.assign(promise, childProcess);

    // Should have stdio properties immediately after Object.assign
    expect(subprocess.stdout).toBeTruthy();
    expect(subprocess.stderr).toBeTruthy();
    expect(subprocess.stdin).toBeTruthy();

    // Should still be a Promise
    expect(subprocess instanceof Promise).toBe(true);

    // Should have stream methods available
    expect(typeof subprocess.stdout.pipe).toBe("function");
    expect(typeof subprocess.stdout.on).toBe("function");
  });
});
