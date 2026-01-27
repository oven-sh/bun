import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { spawn } from "node:child_process";
import { Socket } from "node:net";

// https://github.com/oven-sh/bun/issues/26505
// Child process piped stdout/stderr should be Socket instances, not plain Readable streams

function collectStreamData(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
    stream.on("error", reject);
  });
}

function waitForClose(cp: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise(resolve => {
    cp.on("close", code => resolve(code));
  });
}

test("child process stdout is a Socket instance", async () => {
  const cp = spawn(bunExe(), ["-e", "console.log('hello')"], {
    stdio: "pipe",
    env: bunEnv,
  });

  expect(cp.stdout).toBeInstanceOf(Socket);
  expect(cp.stdout!.constructor.name).toBe("Socket");
  expect(typeof cp.stdout!.ref).toBe("function");
  expect(typeof cp.stdout!.unref).toBe("function");

  const [stdout, exitCode] = await Promise.all([collectStreamData(cp.stdout!), waitForClose(cp)]);

  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);
});

test("child process stderr is a Socket instance", async () => {
  const cp = spawn(bunExe(), ["-e", "console.error('error message')"], {
    stdio: "pipe",
    env: bunEnv,
  });

  expect(cp.stderr).toBeInstanceOf(Socket);
  expect(cp.stderr!.constructor.name).toBe("Socket");
  expect(typeof cp.stderr!.ref).toBe("function");
  expect(typeof cp.stderr!.unref).toBe("function");

  const [stderr, exitCode] = await Promise.all([collectStreamData(cp.stderr!), waitForClose(cp)]);

  expect(stderr.trim()).toBe("error message");
  expect(exitCode).toBe(0);
});

test("child process stdin is not a Socket (it's a Writable)", async () => {
  const cp = spawn(bunExe(), ["-e", "process.stdin.pipe(process.stdout)"], {
    stdio: "pipe",
    env: bunEnv,
  });

  // stdin is a Writable, not a Socket
  expect(cp.stdin).not.toBeInstanceOf(Socket);
  expect(typeof cp.stdin!.write).toBe("function");

  cp.stdin!.write("hello from stdin");
  cp.stdin!.end();

  const [stdout, exitCode] = await Promise.all([collectStreamData(cp.stdout!), waitForClose(cp)]);

  expect(stdout).toBe("hello from stdin");
  expect(exitCode).toBe(0);
});

test("socket ref/unref methods work correctly", async () => {
  const cp = spawn(bunExe(), ["-e", "console.log('done')"], {
    stdio: "pipe",
    env: bunEnv,
  });

  // Should not throw when calling ref/unref
  expect(() => cp.stdout!.ref()).not.toThrow();
  expect(() => cp.stdout!.unref()).not.toThrow();
  expect(() => cp.stderr!.ref()).not.toThrow();
  expect(() => cp.stderr!.unref()).not.toThrow();

  const [stdout, exitCode] = await Promise.all([collectStreamData(cp.stdout!), waitForClose(cp)]);

  expect(stdout.trim()).toBe("done");
  expect(exitCode).toBe(0);
});

test("socket streams work correctly when process exits with non-zero code", async () => {
  const cp = spawn(bunExe(), ["-e", "console.error('error output'); process.exit(1)"], {
    stdio: "pipe",
    env: bunEnv,
  });

  // Verify stream types are correct even for failing processes
  expect(cp.stdout).toBeInstanceOf(Socket);
  expect(cp.stderr).toBeInstanceOf(Socket);
  expect(cp.stdin).not.toBeInstanceOf(Socket);

  // ref/unref should not throw on failing process streams
  expect(() => cp.stdout!.ref()).not.toThrow();
  expect(() => cp.stdout!.unref()).not.toThrow();
  expect(() => cp.stderr!.ref()).not.toThrow();
  expect(() => cp.stderr!.unref()).not.toThrow();

  const [stderr, exitCode] = await Promise.all([collectStreamData(cp.stderr!), waitForClose(cp)]);

  expect(stderr.trim()).toBe("error output");
  expect(exitCode).toBe(1);
});
