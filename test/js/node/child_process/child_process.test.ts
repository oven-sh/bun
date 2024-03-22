import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { ChildProcess, spawn, execFile, exec, fork, spawnSync, execFileSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { bunExe, bunEnv, isWindows } from "harness";
import path from "path";
import { semver } from "bun";
import fs from "fs";
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

const platformTmpDir = require("fs").realpathSync(tmpdir());

function isValidSemver(str) {
  const cmp = str.replaceAll("-debug", "").trim();
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
    const child = spawn("echo", ["hello"]);
    expect(!!child).toBe(true);
  });

  it("should disallow invalid filename", () => {
    let child;
    let child2;
    try {
      // @ts-ignore
      child = spawn(123);
      // @ts-ignore
      child2 = spawn(["echo", "hello"]);
    } catch (e) {}
    expect(!!child).toBe(false);
    expect(!!child2).toBe(false);
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
    const child = spawn(bunExe(), ["-e", "console.log(process.cwd())"], { cwd: platformTmpDir, env: bunEnv });
    const result: string = await new Promise(resolve => {
      child.stdout.on("data", data => {
        resolve(data.toString());
      });
    });
    expect(result.trim()).toBe(platformTmpDir);
  });

  it("should allow us to write to stdin", async () => {
    const child = spawn("tee");
    const result: string = await new Promise(resolve => {
      child.stdin.write("hello");
      child.stdout.on("data", data => {
        resolve(data.toString());
      });
    });
    expect(result.trim()).toBe("hello");
  });

  it("should allow us to timeout hanging processes", async () => {
    const child = spawn("sleep", ["2"], { timeout: 3 });
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
      const child = spawn("printenv", {
        env: env,
        stdio: ["inherit", "pipe", "inherit"],
      });
      const result: object = await new Promise(resolve => {
        let output = "";
        child.stdout.on("data", data => {
          output += data;
        });
        child.stdout.on("end", () => {
          const envs = output
            .split("\n")
            .map(env => env.trim().split("="))
            .filter(env => env.length === 2 && env[0]);
          const obj = Object.fromEntries(envs);
          resolve(obj);
        });
      });
      return result;
    }

    // on Windows, there's a set of environment variables which are always set
    if (isWindows) {
      expect(await getChildEnv({ TEST: "test" })).toMatchObject({ TEST: "test" });
      expect(await getChildEnv({})).toMatchObject({});
      expect(await getChildEnv(undefined)).not.toStrictEqual({});
      expect(await getChildEnv(null)).not.toStrictEqual({});
    } else {
      expect(await getChildEnv({ TEST: "test" })).toEqual({ TEST: "test" });
      expect(await getChildEnv({})).toEqual({});
      expect(await getChildEnv(undefined)).toMatchObject(process.env);
      expect(await getChildEnv(null)).toMatchObject(process.env);
    }
  });

  it("should allow explicit setting of argv0", async () => {
    var resolve: (_?: any) => void;
    const promise = new Promise<string>(resolve1 => {
      resolve = resolve1;
    });
    process.env.NO_COLOR = "1";
    const child = spawn(
      "node",
      ["-e", "console.log(JSON.stringify([process.argv0, fs.realpathSync(process.argv[0])]))"],
      {
        argv0: bunExe(),
        stdio: ["inherit", "pipe", "inherit"],
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
    expect(JSON.parse(result)).toStrictEqual([bunExe(), fs.realpathSync(Bun.which("node"))]);
  });

  it("should allow us to spawn in a shell", async () => {
    const result1: string = await new Promise(resolve => {
      const child1 = spawn("echo", ["$0"], { shell: true });
      child1.stdout.on("data", data => {
        resolve(data.toString());
      });
    });
    const result2: string = await new Promise(resolve => {
      const child2 = spawn("echo", ["$0"], { shell: "bash" });
      child2.stdout.on("data", data => {
        resolve(data.toString());
      });
    });

    // on Windows it will run in comamnd prompt
    // we know it's command prompt because it's the only shell that doesn't support $0.
    expect(result1.trim()).toBe(isWindows ? "$0" : "/bin/sh");

    expect(result2.trim()).toBe("bash");
  });
  it("should spawn a process synchronously", () => {
    const { stdout } = spawnSync("echo", ["hello"], { encoding: "utf8" });
    expect(stdout.trim()).toBe("hello");
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
    const { stdout } = spawnSync("echo", ["hello"], { encoding: "utf8" });
    expect(stdout.trim()).toBe("hello");
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

describe("Bun.spawn()", () => {
  it("should return exit code 0 on successful execution", async () => {
    const proc = Bun.spawn({
      cmd: ["echo", "hello"],
      stdout: "pipe",
      env: bunEnv,
    });

    for await (const chunk of proc.stdout) {
      const text = new TextDecoder().decode(chunk);
      expect(text.trim()).toBe("hello");
    }

    const result = await new Promise(resolve => {
      const maybeExited = Bun.peek(proc.exited);
      if (maybeExited === proc.exited) {
        proc.exited.then(code => resolve(code));
      } else {
        resolve(maybeExited);
      }
    });
    expect(result).toBe(0);
  });
  // it("should fail when given an invalid cwd", () => {
  //   const child = Bun.spawn({ cmd: ["echo", "hello"], cwd: "/invalid" });
  //   expect(child.pid).toBe(undefined);
  // });
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
  await proc.exited;
  expect(proc.exitCode).toBe(0);
  let data = "";
  const reader = proc.stdout.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    data += new TextDecoder().decode(value);
  }
  expect(data).toContain("closeHandler called");
  expect(data).toContain("exithHandler called");
});
