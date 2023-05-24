import { describe, it, expect } from "bun:test";
import { ChildProcess, spawn, execFile, exec, fork, spawnSync, execFileSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const debug = process.env.DEBUG ? console.log : () => {};

const platformTmpDir = require("fs").realpathSync(tmpdir());

// Semver regex: https://gist.github.com/jhorsman/62eeea161a13b80e39f5249281e17c39?permalink_comment_id=2896416#gistcomment-2896416
// Not 100% accurate, but good enough for this test
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z\d][-a-zA-Z.\d]*)?(\+[a-zA-Z\d][-a-zA-Z.\d]*)?$/;

describe("ChildProcess.spawn()", () => {
  it("should emit `spawn` on spawn", async () => {
    const proc = new ChildProcess();
    const result = await new Promise(resolve => {
      proc.on("spawn", () => {
        resolve(true);
      });
      // @ts-ignore
      proc.spawn({ file: "bun", args: ["bun", "-v"] });
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
      proc.spawn({ file: "bun", args: ["bun", "-v"] });
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

  it.todo("should allow stdout to be read via Node stream.Readable `data` events", async () => {
    const child = spawn("bun", ["-v"]);
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
    expect(SEMVER_REGEX.test(result.trim())).toBe(true);
  });

  it.todo("should allow stdout to be read via .read() API", async () => {
    const child = spawn("bun", ["-v"]);
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
    expect(SEMVER_REGEX.test(result.trim())).toBe(true);
  });

  it("should accept stdio option with 'ignore' for no stdio fds", async () => {
    const child1 = spawn("bun", ["-v"], {
      stdio: "ignore",
    });
    const child2 = spawn("bun", ["-v"], {
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
    const child = spawn("pwd", { cwd: platformTmpDir });
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
    const child = spawn("env", { env: { TEST: "test" } });
    const result: string = await new Promise(resolve => {
      child.stdout.on("data", data => {
        resolve(data.toString());
      });
    });
    expect(/TEST\=test/.test(result)).toBe(true);
  });

  it("should allow explicit setting of argv0", async () => {
    var resolve: (_?: any) => void;
    const promise = new Promise<string>(resolve1 => {
      resolve = resolve1;
    });
    process.env.NO_COLOR = "1";
    const child = spawn("node", ["--help"], { argv0: "bun" });
    delete process.env.NO_COLOR;
    let msg = "";

    child.stdout.on("data", data => {
      msg += data.toString();
    });

    child.stdout.on("close", () => {
      resolve(msg);
    });

    const result = await promise;
    expect(/Open bun's Discord server/.test(result)).toBe(true);
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
    expect(result1.trim()).toBe(Bun.which("sh"));
    expect(result2.trim()).toBe(Bun.which("bash"));
  });
  it("should spawn a process synchronously", () => {
    const { stdout } = spawnSync("echo", ["hello"], { encoding: "utf8" });
    expect(stdout.trim()).toBe("hello");
  });
});

describe("execFile()", () => {
  it.todo("should execute a file", async () => {
    const result: Buffer = await new Promise((resolve, reject) => {
      execFile("bun", ["-v"], { encoding: "buffer" }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });
    expect(SEMVER_REGEX.test(result.toString().trim())).toBe(true);
  });
});

describe("exec()", () => {
  it.todo("should execute a command in a shell", async () => {
    const result: Buffer = await new Promise((resolve, reject) => {
      exec("bun -v", { encoding: "buffer" }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });
    expect(SEMVER_REGEX.test(result.toString().trim())).toBe(true);
  });

  it.todo("should return an object w/ stdout and stderr when promisified", async () => {
    const result = await promisify(exec)("bun -v");
    expect(typeof result).toBe("object");
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");

    const { stdout, stderr } = result;
    expect(SEMVER_REGEX.test(stdout.trim())).toBe(true);
    expect(stderr.trim()).toBe("");
  });
});

describe("fork()", () => {
  it("should throw an error when used", () => {
    let err;
    try {
      fork("index.js");
    } catch (e) {
      err = e;
    }
    expect(err instanceof Error).toBe(true);
  });
});

describe("spawnSync()", () => {
  it("should spawn a process synchronously", () => {
    const { stdout } = spawnSync("echo", ["hello"], { encoding: "utf8" });
    expect(stdout.trim()).toBe("hello");
  });
});

describe("execFileSync()", () => {
  it.todo("should execute a file synchronously", () => {
    const result = execFileSync("bun", ["-v"], { encoding: "utf8" });
    expect(SEMVER_REGEX.test(result.trim())).toBe(true);
  });

  it("should allow us to pass input to the command", () => {
    const result = execFileSync("node", [import.meta.dir + "/spawned-child.js", "STDIN"], {
      input: "hello world!",
      encoding: "utf8",
    });
    expect(result.trim()).toBe("data: hello world!");
  });
});

describe("execSync()", () => {
  it.todo("should execute a command in the shell synchronously", () => {
    const result = execSync("bun -v", { encoding: "utf8" });
    expect(SEMVER_REGEX.test(result.trim())).toBe(true);
  });
});

describe("Bun.spawn()", () => {
  it("should return exit code 0 on successful execution", async () => {
    const proc = Bun.spawn({
      cmd: ["echo", "hello"],
      stdout: "pipe",
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
