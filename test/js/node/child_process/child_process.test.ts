import { semver, write } from "bun";
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, nodeExe, runBunInstall, shellExe, tmpdirSync } from "harness";
import { ChildProcess, exec, execFile, execFileSync, execSync, fork, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
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

  // `errors` collects every "error" the child emits, including ones emitted by
  // kill() after the awaited lifecycle events, and is asserted empty.
  it("kill() on a running process returns true and sets .killed", async () => {
    const child = spawn(bunExe(), ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: bunEnv });
    const errors: unknown[] = [];
    child.on("error", err => errors.push(err));
    await once(child, "spawn");
    const closed = once(child, "close");
    try {
      expect(child.killed).toBe(false);
      expect(child.kill(0)).toBe(true);
      expect(child.kill()).toBe(true);
      expect(child.killed).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
    await closed;
    expect(errors).toEqual([]);
  });

  it("kill() after the process has exited returns false and does not set .killed", async () => {
    const child = spawn(bunExe(), ["-e", ""], { stdio: "ignore", env: bunEnv });
    const errors: unknown[] = [];
    child.on("error", err => errors.push(err));
    await once(child, "close");

    expect({
      exitCode: child.exitCode,
      "kill()": child.kill(),
      "kill(0)": child.kill(0),
      "kill('SIGTERM')": child.kill("SIGTERM"),
      killed: child.killed,
      errors,
    }).toEqual({
      exitCode: 0,
      "kill()": false,
      "kill(0)": false,
      "kill('SIGTERM')": false,
      killed: false,
      errors: [],
    });
  });

  it("kill() after the process was killed returns false but .killed stays true", async () => {
    const child = spawn(bunExe(), ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: bunEnv });
    const errors: unknown[] = [];
    child.on("error", err => errors.push(err));
    await once(child, "spawn");
    const closed = once(child, "close");
    expect(child.kill()).toBe(true);
    expect(child.killed).toBe(true);
    await closed;

    expect({
      "kill()": child.kill(),
      "kill(0)": child.kill(0),
      killed: child.killed,
      errors,
    }).toEqual({
      "kill()": false,
      "kill(0)": false,
      killed: true,
      errors: [],
    });
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

  describe("stdin for non-pipe stdio[0] stays null after exit", () => {
    it.each([
      ["ignore", ["ignore", "ignore", "ignore"]],
      ["inherit", ["inherit", "ignore", "ignore"]],
      ["fd 0", [0, "ignore", "ignore"]],
    ] as const)("spawn stdio[0]=%s", async (_, stdio) => {
      const child = spawn(bunExe(), ["-e", "0"], { env: bunEnv, stdio: stdio as any });
      await once(child, "close");
      expect(child.stdin).toBe(null);
      expect(child.stdout).toBe(null);
      expect(child.stderr).toBe(null);
    });

    it("fork() default stdio", async () => {
      const dir = tmpdirSync();
      const kid = path.join(dir, "kid.cjs");
      fs.writeFileSync(kid, "process.exit(0)");
      const child = fork(kid, [], { execPath: bunExe(), env: bunEnv });
      await once(child, "close");
      expect(child.stdin).toBe(null);
    });

    it("stdio[0]='pipe' still yields a destroyed Writable after exit", async () => {
      const child = spawn(bunExe(), ["-e", "0"], { env: bunEnv, stdio: ["pipe", "ignore", "ignore"] });
      await once(child, "close");
      expect(child.stdin).not.toBe(null);
      expect(child.stdin!.destroyed).toBe(true);
    });
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

  it.skipIf(isWindows)(
    "stdin write failure (EPIPE) emits 'error' and destroys even with a write callback",
    async () => {
      // Child closes its own stdin fd, signals ready on stdout, then stays alive.
      const child = spawn(
        bunExe(),
        ["-e", `require("fs").closeSync(0); process.stdout.write("ready\\n"); setInterval(() => {}, 1e5);`],
        { env: bunEnv, stdio: ["pipe", "pipe", "ignore"] },
      );
      try {
        await new Promise<void>((resolve, reject) => {
          child.on("error", reject);
          child.on("exit", () => reject(new Error("child exited before ready")));
          child.stdout!.once("data", () => resolve());
        });
        child.removeAllListeners("error");
        child.removeAllListeners("exit");

        const errEv = Promise.withResolvers<any>();
        const cb1 = Promise.withResolvers<any>();
        child.stdin!.on("error", e => errEv.resolve(e));
        child.stdin!.write(Buffer.alloc(65536, 0x41), e => cb1.resolve(e));

        const [cb1Err, errEvErr] = await Promise.all([cb1.promise, errEv.promise]);

        expect({
          cb1: cb1Err?.code,
          errEv: errEvErr?.code,
          destroyed: child.stdin!.destroyed,
          writable: child.stdin!.writable,
        }).toEqual({
          cb1: "EPIPE",
          errEv: "EPIPE",
          destroyed: true,
          writable: false,
        });

        const cb2 = Promise.withResolvers<any>();
        const r2 = child.stdin!.write("more-bytes", e => cb2.resolve(e));
        const cb2Err = await cb2.promise;

        expect({ r2, cb2: cb2Err?.code }).toEqual({ r2: false, cb2: "ERR_STREAM_DESTROYED" });
      } finally {
        child.kill("SIGKILL");
      }
    },
  );
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

  it.if(isLinux)("detached: true starts the child in a new process group", () => {
    // /proc/self/stat field 5 is pgrp; parse after the last ')' since comm may contain spaces.
    const pgrp = (stat: string) => stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2];
    const childPgid = (detached: boolean) =>
      pgrp(spawnSync("cat", ["/proc/self/stat"], { detached, encoding: "utf8" }).stdout);
    const parentPgid = pgrp(fs.readFileSync("/proc/self/stat", "utf8"));

    expect(parentPgid).toMatch(/^\d+$/);
    expect(childPgid(false)).toBe(parentPgid);
    const detachedPgid = childPgid(true);
    expect(detachedPgid).toMatch(/^\d+$/);
    expect(detachedPgid).not.toBe(parentPgid);
  });

  it.skipIf(isWindows)("drains piped stdio to EOF after the direct child exits", () => {
    // Node.js documents spawnSync as not returning until the child process has
    // fully closed, i.e. every pipe has been read to EOF even when a grandchild
    // that inherited the pipe is still writing after the direct child exited.
    const cmd = ["-c", `printf A; printf C >&2; ( sleep 0.3; printf B; printf D >&2 ) & exit 0`];
    const { stdout, stderr, status, signal } = spawnSync("/bin/sh", cmd, { stdio: ["ignore", "pipe", "pipe"] });
    expect({ stdout: String(stdout), stderr: String(stderr), status, signal }).toEqual({
      stdout: "AB",
      stderr: "CD",
      status: 0,
      signal: null,
    });
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

  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdio: ["inherit", "pipe", "pipe"],
    env: bunEnv,
  });
  const [installStderr, installExitCode] = await Promise.all([installProc.stderr.text(), installProc.exited]);
  if (installExitCode !== 0) {
    throw new Error(`bun install failed with exit code ${installExitCode}:\n${installStderr}`);
  }

  await using runProc = Bun.spawn({
    cmd: [bunExe(), "--bun", "run", "all"],
    cwd: package_dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  const [err, out, exitCode] = await Promise.all([runProc.stderr.text(), runProc.stdout.text(), runProc.exited]);
  try {
    // This command outputs in either `["hello", "world"]` or `["world", "hello"]` order.
    expect([err.split("\n")[0], ...err.split("\n").slice(1, -1).sort(), err.split("\n").at(-1)]).toEqual([
      "$ run-p echo-hello echo-world",
      "$ echo hello",
      "$ echo world",
      "",
    ]);
    expect(out.split("\n").slice(0, -1).sort()).toStrictEqual(["hello", "world"].sort());
    expect(exitCode).toBe(0);
  } catch (e) {
    console.error({ exitCode, err, out });
    throw e;
  }
}, 30_000);

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

// SIGSTKFLT (signal 16 on Linux) used to be reported as the made-up name
// "SIG16" on child exit, even though os.constants.signals and child.kill()
// both spell it "SIGSTKFLT". Node reports "SIGSTKFLT".
it.if(isLinux)("child killed by SIGSTKFLT reports 'SIGSTKFLT', not 'SIG16'", async () => {
  expect(os.constants.signals.SIGSTKFLT).toBe(16);

  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  const { promise, resolve, reject } = Promise.withResolvers<[number | null, string | null]>();
  child.on("exit", (code, signal) => resolve([code, signal]));
  child.on("error", reject);
  await once(child, "spawn");

  expect(child.kill("SIGSTKFLT")).toBe(true);
  const [code, signal] = await promise;

  expect({ code, signal, signalCode: child.signalCode }).toEqual({
    code: null,
    signal: "SIGSTKFLT",
    signalCode: "SIGSTKFLT",
  });
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

// https://github.com/oven-sh/bun/issues/32067
// Darwin's posix_spawn file actions reject any fd number >= OPEN_MAX (10240)
// with EBADF at registration time, before checking whether the fd is open.
// Bun used to swallow that error and spawn anyway with the action silently
// dropped, so the child ran with closed stdio and looked like a successful
// run that produced no output. The spawn must fail with EBADF, matching
// node. On other POSIX platforms the child-side dup2 of an fd that is not
// open fails with EBADF, so the observable behavior is the same.
it.if(!isWindows)("spawn with an fd number at Darwin OPEN_MAX in stdio reports EBADF", () => {
  // Precondition: fd 10240 is not open in this process, so the fd is
  // invalid on every platform (on Darwin it is invalid by number alone).
  expect(() => fs.fstatSync(10240)).toThrow();

  const r = spawnSync("echo", ["hi"], { stdio: ["ignore", "pipe", "pipe", 10240] });
  expect({
    status: r.status ?? null,
    stdout: r.stdout?.toString() ?? null,
    error: r.error?.code ?? null,
  }).toEqual({ status: null, stdout: null, error: "EBADF" });

  // Async spawn throws synchronously: EBADF is not in node's delayed-error
  // list (EACCES/EAGAIN/EMFILE/ENFILE/ENOENT), so node throws here too.
  let asyncCode: string | undefined;
  try {
    spawn("echo", ["hi"], { stdio: ["ignore", "pipe", "pipe", 10240] });
  } catch (err: any) {
    asyncCode = err.code;
  }
  expect(asyncCode).toBe("EBADF");
});

// https://github.com/oven-sh/bun/issues/32067
// The fd-pressure variant of the case above: with more than 10240 fds open,
// freshly created stdio pipes get numbers past OPEN_MAX. Linux has no such
// cap, so spawning must keep working. The test is Linux-only because default
// macOS installs cap RLIMIT_NOFILE at kern.maxfilesperproc = 10240, which
// makes it impossible to open this many fds there (the Darwin EBADF surface
// is covered by the test above, which needs no fd pressure).
it.if(isLinux)("spawn still works with more than 10240 fds open", async () => {
  const script = /* js */ `
      const fs = require("fs");
      const { spawn, spawnSync } = require("child_process");

      let opened = 0;
      let setup = "ok";
      try {
        for (; opened < 11000; opened++) fs.openSync("/dev/null", "r");
      } catch (err) {
        setup = err.code + " after " + opened + " fds";
      }

      const r = spawnSync("echo", ["hi"], { stdio: ["ignore", "pipe", "pipe"] });
      const sync = {
        status: r.status ?? null,
        stdout: r.stdout?.toString() ?? null,
        error: r.error?.code ?? null,
      };

      let asyncResult;
      try {
        const child = spawn("echo", ["hi"], { stdio: ["ignore", "pipe", "pipe"] });
        asyncResult = await new Promise(resolve => {
          child.on("error", err => resolve({ outcome: "error-event", code: err.code }));
          child.on("exit", code => resolve({ outcome: "exit", code }));
        });
      } catch (err) {
        asyncResult = { outcome: "throw", code: err.code };
      }

      console.log(JSON.stringify({ setup, sync, async: asyncResult }));
    `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  let result: any;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`child did not produce a result; stdout: ${JSON.stringify(stdout)} stderr: ${stderr}`);
  }

  expect(result).toEqual({
    setup: "ok",
    sync: { status: 0, stdout: "hi\n", error: null },
    async: { outcome: "exit", code: 0 },
  });
  expect(exitCode).toBe(0);
});

// Extra-stdio "pipe" slots are wrapped in net.Socket by child_process, which
// hands the fd to usockets. The Subprocess's stdio_pipes slot must be
// downgraded from OwnedFd to UnownedFd so that when the JS Subprocess is
// GC'd, finalize_streams does not close the fd a second time (EBADF, or
// worse, closing a reused fd number). Before the fix, Fd::close()'s
// debug_assert!(err.is_none()) panicked under debug_assertions builds.
it.skipIf(isWindows)("extra stdio pipes are not double-closed on GC", async () => {
  // Run in a subprocess so GC/finalize timing is isolated from the test
  // runner's own state, and so the assert abort surfaces as a non-zero
  // exit rather than taking the whole test runner down.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { spawn } = require("node:child_process");
        async function once() {
          const child = spawn(process.execPath, ["-e", ""], {
            stdio: ["ignore", "ignore", "ignore", "pipe", "pipe", "pipe"],
          });
          const sockets = child.stdio.slice(3);
          if (sockets.length !== 3) throw new Error("expected 3 extra sockets");
          await new Promise(r => child.on("exit", r));
          for (const s of sockets) s.destroy();
          await new Promise(r => setTimeout(r, 10));
        }
        for (let i = 0; i < 20; i++) {
          await once();
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 0));
          Bun.gc(true);
        }
        console.log("OK");
      `,
    ],
    env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "OK", stderr: "", exitCode: 0 });
});

// For fd 0-2, "ignore" opens /dev/null. For fd >= 3, Node leaves the fd
// closed; Bun used to open /dev/null on the slot, so children probing
// "is fd N open?" observed a different answer than under Node.
it.if(!isWindows)("stdio[i] = 'ignore' for i >= 3 leaves the fd closed in the child", async () => {
  // Portable open/closed probe via shell redirection: redirecting a closed
  // fd fails with EBADF. Uses "true" (not ":") because redirection errors on
  // POSIX special built-ins abort the shell.
  const probe = `
for fd in 0 3 4 5; do
  if { true >&$fd; } 2>/dev/null || { true <&$fd; } 2>/dev/null; then
    echo "fd$fd=OPEN"
  else
    echo "fd$fd=CLOSED"
  fi
done
`;

  // fd 3 and 4 are ignored; fd 5 is a pipe so the close-range floor is
  // above the ignored slots and cannot mask the bug.
  const stdio = ["ignore", "pipe", "pipe", "ignore", "ignore", "pipe"] as const;
  const expected = ["fd0=OPEN", "fd3=CLOSED", "fd4=CLOSED", "fd5=OPEN"];

  const sync = spawnSync("sh", ["-c", probe], { stdio: [...stdio], env: bunEnv });
  expect(sync.stderr?.toString()).toBe("");
  expect(sync.stdout?.toString().trim().split("\n")).toEqual(expected);
  expect(sync.status).toBe(0);

  // Async spawn goes through the same native path.
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const child = spawn("sh", ["-c", probe], { stdio: [...stdio], env: bunEnv });
  let out = "";
  child.stdout!.on("data", d => (out += d));
  child.on("error", reject);
  child.on("close", () => resolve(out));
  const asyncOut = await promise;
  expect(asyncOut.trim().split("\n")).toEqual(expected);
});

describe("uid/gid options", () => {
  const isRoot = process.getuid?.() === 0;
  // 65534 is "nobody" on every Linux distro and on macOS.
  const NOBODY = 65534;

  it.skipIf(isWindows || !isRoot)("spawnSync applies uid/gid and drops supplementary groups", () => {
    const both = spawnSync("id", [], { uid: NOBODY, gid: NOBODY, encoding: "utf8" });
    expect(both.error).toBeUndefined();
    expect(both.stdout).toContain(`uid=${NOBODY}`);
    expect(both.stdout).toContain(`gid=${NOBODY}`);

    // libuv (and Node) call setgroups(0, NULL) before setgid/setuid, so the
    // child must not retain root's supplementary group 0.
    const groups = spawnSync("id", ["-G"], { uid: NOBODY, gid: NOBODY, encoding: "utf8" });
    expect(groups.error).toBeUndefined();
    expect(groups.stdout.trim()).toBe(`${NOBODY}`);

    const gidOnly = spawnSync("id", [], { gid: NOBODY, encoding: "utf8" });
    expect(gidOnly.error).toBeUndefined();
    expect(gidOnly.stdout).toContain("uid=0");
    expect(gidOnly.stdout).toContain(`gid=${NOBODY}`);
  });

  it.skipIf(isWindows || !isRoot)("spawn applies uid/gid (async)", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ out: string; code: number | null }>();
    const child = spawn("id", ["-u"], { uid: NOBODY, gid: NOBODY });
    let out = "";
    child.stdout.on("data", d => (out += d));
    child.on("error", reject);
    child.on("close", code => resolve({ out, code }));
    const { out: stdout, code } = await promise;
    expect(stdout.trim()).toBe(`${NOBODY}`);
    expect(code).toBe(0);
  });

  it.skipIf(isWindows || isRoot)("spawn with a uid the process cannot set throws EPERM synchronously", () => {
    // Node defers only EACCES/EAGAIN/EMFILE/ENFILE/ENOENT to the 'error'
    // event; EPERM is thrown synchronously from spawn().
    let thrown: any;
    try {
      spawn("id", [], { uid: 0 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe("EPERM");
    expect(thrown?.errno).toBe(-1);
    expect(thrown?.syscall).toBe("spawn");

    const r = spawnSync("id", [], { uid: 0, encoding: "utf8" });
    expect(r.error?.code).toBe("EPERM");
    expect(r.error?.errno).toBe(-1);
    expect(r.error?.syscall).toBe("spawnSync id");
    expect(r.stdout == null).toBe(true);
  });

  it.skipIf(isWindows || !isRoot)("spawn reports EPERM after dropping privileges", async () => {
    const fixture = `const cp = require("node:child_process");
let thrown = null;
try { cp.spawn("id", [], { uid: 0 }); } catch (e) { thrown = e; }
const r = cp.spawnSync("id", [], { uid: 0 });
console.log(JSON.stringify({ uid: process.getuid(), threwCode: thrown?.code, threwErrno: thrown?.errno, threwSyscall: thrown?.syscall, syncCode: r.error?.code, gotStdout: r.stdout != null }));`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      // The de-privileged child re-spawns from its cwd, so the cwd must be
      // traversable by uid 65534 (the harness tmpdir is mode 0700, root-owned).
      cwd: "/",
      uid: NOBODY,
      gid: NOBODY,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout), exitCode }).toEqual({
      result: {
        uid: NOBODY,
        threwCode: "EPERM",
        threwErrno: -1,
        threwSyscall: "spawn",
        syncCode: "EPERM",
        gotStdout: false,
      },
      exitCode: 0,
    });
  });

  it.if(isWindows)("spawn with uid/gid fails with ENOTSUP on Windows", () => {
    let thrown: any;
    try {
      spawn("cmd.exe", ["/c", "exit 0"], { uid: 0 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe("ENOTSUP");

    const r = spawnSync("cmd.exe", ["/c", "exit 0"], { gid: 0 });
    expect(r.error?.code).toBe("ENOTSUP");
  });
});

// Regression: Bun registered the stdout/stderr poll immediately, so the native
// reader drained the child's output into an unbounded in-memory buffer before
// any JS consumer attached. The child never blocked on a full pipe, and once
// 'exit' fired the autoResume path discarded the entire buffered output, so a
// late reader received 0 bytes. With kernel backpressure the child blocks at
// the pipe buffer until JS starts reading, matching Node.
describe.skipIf(!isPosix)("stdout pipe backpressure", () => {
  it("blocks the child until a reader attaches and delivers every byte", async () => {
    const SIZE = 1024 * 1024;
    const c = spawn("sh", ["-c", `head -c ${SIZE} /dev/zero`], {
      stdio: ["ignore", "pipe", "ignore"],
      env: bunEnv,
    });
    try {
      // Give the event loop time to do whatever eager draining it would do
      // without backpressure. Deadline-polled: breaks early if the child
      // manages to exit.
      const deadline = Date.now() + 1000;
      while (c.exitCode === null && Date.now() < deadline) {
        await new Promise(r => setImmediate(r));
      }

      // SIZE is larger than the kernel socket buffer, so the child cannot
      // have finished writing without the parent reading.
      expect(c.exitCode).toBeNull();

      // Attach late and count every byte. Previously this reported 0.
      let got = 0;
      c.stdout!.on("data", chunk => {
        got += chunk.length;
      });
      await once(c.stdout!, "end");
      expect(got).toBe(SIZE);

      await once(c, "close");
      expect(c.exitCode).toBe(0);
    } finally {
      c.kill();
    }
  });

  it("still drains a paused stdout to 'close' after the child exits", async () => {
    const c = spawn("sh", ["-c", "echo hello"], {
      stdio: ["ignore", "pipe", "ignore"],
      env: bunEnv,
    });
    c.stdout!.pause();
    await once(c, "close");
    expect(c.exitCode).toBe(0);
  });
});
