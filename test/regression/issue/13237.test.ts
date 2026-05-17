// https://github.com/oven-sh/bun/issues/13237
//
// Bun.write with a Response/Request whose body is a ReadableStream used to
// hang forever: the `.Locked` body path only installed an `onReceiveValue`
// callback and never actually read from the stream, so the returned promise
// never settled.
//
// These tests spawn subprocesses so a hang turns into a clean failure instead
// of blocking the test runner.

import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function run(dir: string, script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("Bun.write with a ReadableStream-backed body", () => {
  it("Bun.write(path, new Response(ReadableStream))", async () => {
    using dir = tempDir("issue-13237-response-stream", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      `
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello "));
            controller.enqueue(new TextEncoder().encode("world"));
            controller.close();
          },
        });
        const written = await Bun.write(${JSON.stringify(out)}, new Response(stream));
        console.log(JSON.stringify({ written, text: await Bun.file(${JSON.stringify(out)}).text() }));
      `,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ written: 11, text: "hello world" });
    expect(exitCode).toBe(0);
  });

  it("Bun.write(path, new Request(url, { body: ReadableStream }))", async () => {
    using dir = tempDir("issue-13237-request-stream", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      `
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("from request"));
            controller.close();
          },
        });
        const req = new Request("http://example.com", { method: "POST", body: stream });
        const written = await Bun.write(${JSON.stringify(out)}, req);
        console.log(JSON.stringify({ written, text: await Bun.file(${JSON.stringify(out)}).text() }));
      `,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ written: 12, text: "from request" });
    expect(exitCode).toBe(0);
  });

  it("Bun.file(path).write(new Response(ReadableStream))", async () => {
    using dir = tempDir("issue-13237-file-write", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      `
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("instance method"));
            controller.close();
          },
        });
        const written = await Bun.file(${JSON.stringify(out)}).write(new Response(stream));
        console.log(JSON.stringify({ written, text: await Bun.file(${JSON.stringify(out)}).text() }));
      `,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ written: 15, text: "instance method" });
    expect(exitCode).toBe(0);
  });

  it("Bun.write(path, new Response(req.body)) inside a server handler", async () => {
    using dir = tempDir("issue-13237-server-response-body", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      `
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            const written = await Bun.write(${JSON.stringify(out)}, new Response(req.body));
            return new Response(String(written));
          },
        });
        const res = await fetch(server.url, { method: "POST", body: "hello from server" });
        const written = await res.text();
        server.stop();
        console.log(JSON.stringify({ written, text: await Bun.file(${JSON.stringify(out)}).text() }));
      `,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ written: "17", text: "hello from server" });
    expect(exitCode).toBe(0);
  });

  it("Bun.write(path, new Response(ReadableStream)) truncates the destination file", async () => {
    using dir = tempDir("issue-13237-truncate", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      `
        const body = (n, c) =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(Buffer.alloc(n, c));
                controller.close();
              },
            }),
          );
        await Bun.write(${JSON.stringify(out)}, body(1000, "A"));
        await Bun.write(${JSON.stringify(out)}, body(100, "B"));
        const text = await Bun.file(${JSON.stringify(out)}).text();
        console.log(JSON.stringify({ length: text.length, ok: text === Buffer.alloc(100, "B").toString() }));
      `,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ length: 100, ok: true });
    expect(exitCode).toBe(0);
  });

  it("Bun.write(path, req) after accessing req.body inside a server handler", async () => {
    using dir = tempDir("issue-13237-server-body-access", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      `
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            if (!req.body) return new Response("no body", { status: 400 });
            const written = await Bun.write(${JSON.stringify(out)}, req);
            return new Response(String(written));
          },
        });
        const res = await fetch(server.url, { method: "POST", body: "body was touched" });
        const written = await res.text();
        server.stop();
        console.log(JSON.stringify({ written, text: await Bun.file(${JSON.stringify(out)}).text() }));
      `,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ written: "16", text: "body was touched" });
    expect(exitCode).toBe(0);
  });
});
