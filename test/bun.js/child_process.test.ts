import { describe, it, expect } from "bun:test";
import { ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { compileSchemaCPP } from "../../node_modules/peechy/peechy";

// Semver regex: https://gist.github.com/jhorsman/62eeea161a13b80e39f5249281e17c39?permalink_comment_id=2896416#gistcomment-2896416
// Not 100% accurate, but good enough for this test
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z\d][-a-zA-Z.\d]*)?(\+[a-zA-Z\d][-a-zA-Z.\d]*)?$/;

describe("ChildProcess.spawn()", () => {
  it("should emit `spawn` on spawn", async () => {
    const proc = new ChildProcess();
    const result = await new Promise((resolve) => {
      proc.on("spawn", () => {
        resolve(true);
      });
      proc.spawn({ file: "bun", args: ["bun", "-v"] });
    });
    expect(result).toBe(true);
  });

  it("should emit `exit` when killed", async () => {
    const proc = new ChildProcess();
    const result = await new Promise((resolve) => {
      proc.on("exit", () => {
        resolve(true);
      });

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
      child = spawn(123);
      child2 = spawn(["echo", "hello"]);
    } catch (e) {
      console.error(e);
    }
    expect(!!child).toBe(false);
    expect(!!child2).toBe(false);
  });

  it("should allow stdout to be read via Node stream.Readable `data` events", async () => {
    const child = spawn("bun", ["-v"]);
    const result: string = await new Promise((resolve) => {
      child.stdout.on("error", (e) => {
        console.error(e);
      });
      child.stdout.on("data", (data) => {
        console.log(`stdout: ${data}`);
        resolve(data);
      });
      child.stderr.on("data", (data) => {
        console.log(`stderr: ${data}`);
      });
    });
    expect(SEMVER_REGEX.test(result.trim())).toBe(true);
  });

  it("should allow stdout to be read via .read() API", async () => {
    const child = spawn("bun", ["-v"]);
    const result: string = await new Promise((resolve) => {
      let finalData = "";
      child.stdout.on("error", (e) => {
        console.error(e);
      });
      child.stdout.on("readable", () => {
        let data;

        while ((data = child.stdout.read()) !== null) {
          finalData += data;
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
    const PRIVATE_DIR = "/private";
    const child = spawn("pwd", { cwd: "/tmp" });
    const result: string = await new Promise((resolve) => {
      child.stdout.on("data", (data) => {
        resolve(data);
      });
    });
    expect(result.trim()).toBe(`${PRIVATE_DIR}/tmp`);
  });

  it("should allow us to timeout hanging processes", async () => {
    const child = spawn("sleep", ["750"], { timeout: 250 });
    const start = performance.now();
    let end;
    await new Promise((resolve) => {
      child.on("exit", () => {
        end = performance.now();
        resolve(0);
      });
    });
    expect(end - start < 750).toBe(true);
  });

  it("should allow us to set env", async () => {
    const child = spawn("env", { env: { TEST: "test" } });
    const result: string = await new Promise((resolve) => {
      child.stdout.on("data", (data) => {
        resolve(data);
      });
    });
    expect(/TEST\=test/.test(result)).toBe(true);
  });

  it("should allow explicit setting of argv0", async () => {
    const child = spawn("node", ["--help"], { argv0: "bun" });
    const result: string = await new Promise((resolve) => {
      let msg;
      child.stdout.on("data", (data) => {
        msg += data;
      });

      child.stdout.on("close", () => {
        resolve(msg);
      });
    });
    expect(/bun:/.test(result)).toBe(true);
  });

  it("should allow us to spawn in a shell", async () => {
    const child1 = spawn("echo", ["$0"], { shell: true });
    const child2 = spawn("echo", ["$0"], { shell: "bash" });
    const result1: string = await new Promise((resolve) => {
      child1.stdout.on("data", (data) => {
        resolve(data);
      });
    });
    const result2: string = await new Promise((resolve) => {
      child2.stdout.on("data", (data) => {
        resolve(data);
      });
    });
    expect(result1.trim()).toBe("/bin/sh");
    expect(result2.trim()).toBe("/bin/bash");
  });
});
