import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow } from "harness";

describe("spawn with empty", () => {
  for (const [stdin, label] of [
    [new ArrayBuffer(0), "ArrayBuffer"],
    [new Uint8Array(0), "Uint8Array"],
    [new Blob([]), "Blob"],
  ] as const) {
    test(label + " for stdin", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin: stdin as Uint8Array | Blob,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [exited, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
      expect(exited).toBe(0);
      expect(stdout).toBeEmpty();
      expect(stderr).toBeEmpty();
    });
  }
});

// A Blob is refused for stdout, stderr and the extra stdio slots. A Response or a
// Request with an all-ASCII string body reaches that refusal as a reference on
// the string, so the refusal has to release it.
describe("spawn releases the string body of a Response or Request that it refuses", () => {
  const cases: [name: string, call: string][] = [
    ["Bun.spawn stdout", `Bun.spawn(cmd, { stdout: new Response(body) })`],
    ["Bun.spawn stderr", `Bun.spawn(cmd, { stderr: new Response(body) })`],
    ["Bun.spawn stdio[3]", `Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore", new Response(body)] })`],
    ["Bun.spawnSync stdout", `Bun.spawnSync(cmd, { stdout: new Response(body) })`],
    [
      "Bun.spawn stdout, a Request",
      `Bun.spawn(cmd, { stdout: new Request("http://127.0.0.1:1/", { method: "POST", body }) })`,
    ],
    // The shell starts an external command through the same stdio setup.
    ["Bun.$ > redirect", "Bun.$`${cmd} > ${new Response(body)}`.quiet()"],
    ["Bun.$ 2> redirect", "Bun.$`${cmd} 2> ${new Response(body)}`.quiet()"],
  ];

  // One child at a time: a debug build is too slow to run all of them at once.
  test.each(cases)("%s", async (_name, call) => {
    const code = /* js */ `
      const cmd = [process.execPath, "--version"];
      const pad = Buffer.alloc(4 * 1024 * 1024, "a").toString();
      let seq = 0;
      async function run(calls) {
        for (let i = 0; i < calls; i++) {
          // A fresh string for each call: one reused string is one allocation.
          const body = ++seq + pad;
          try { await ${call}; } catch {}
        }
        Bun.gc(true);
        return process.memoryUsage.rss();
      }
      const before = await run(8);
      const after = await run(48);
      console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
    `;
    // Unfixed: 192 MiB, the 48 bodies of 4 MiB. Fixed: under 4 MiB on a release
    // build and 8 to 21 MiB on a debug build, where a loop that only flattens
    // the string measures the same.
    await expectRssDeltaBelow(["--smol", "-e", code], { release: 48, debug: 96 });
  });
});

// An S3 file has no path or fd to hand to the child, and its bytes are not in memory.
describe("an S3-backed Blob as stdin", () => {
  const refusal = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: "An S3-backed Blob cannot be used as stdin. Pass await blob.bytes() instead",
  });

  // Stands in for S3 on the loopback, and records each request.
  function s3StandIn() {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response("from-s3");
      },
    });
    const options = { endpoint: server.url.href, accessKeyId: "test", secretAccessKey: "test", bucket: "bucket" };
    const client = new Bun.S3Client(options);
    return {
      requests,
      options,
      file: (key = "key") => client.file(key),
      // A request that an earlier call started reaches the stand-in before this one is answered.
      async requestsAfterOneRead() {
        expect(await client.file("after").text()).toBe("from-s3");
        return requests;
      },
      [Symbol.dispose]: () => void server.stop(true),
    };
  }
  type S3 = ReturnType<typeof s3StandIn>;

  const inputs: [string, (s3: S3) => Blob | Request | Response][] = [
    ["an S3File", s3 => s3.file()],
    ["Bun.file() of an s3:// URL", s3 => Bun.file("s3://bucket/key", s3.options as any)],
    ["a slice of an S3File", s3 => s3.file().slice(0, 4)],
    ["a zero-length slice of an S3File", s3 => s3.file().slice(0, 0)],
    ["a Blob made of one S3File", s3 => new Blob([s3.file()])],
    ["a Request with an S3File body", s3 => new Request("http://example.com/", { method: "POST", body: s3.file() })],
    ["a Response made of one S3File", s3 => new Response([s3.file()] as any)],
    [
      "a Request with an S3File body that Bun.inspect() has seen",
      s3 => {
        const request = new Request("http://example.com/", { method: "POST", body: s3.file() });
        // Bun.inspect() resolves the size of the body, and the size of an S3 file resolves to 0.
        Bun.inspect(request);
        return request;
      },
    ],
  ];

  test.each(inputs)("%s is refused, and nothing is read from S3", async (_, make) => {
    using s3 = s3StandIn();
    const options = { cmd: [bunExe(), "-e", ""], env: bunEnv, stdout: "ignore", stderr: "ignore" } as const;
    expect(() => Bun.spawn({ ...options, stdin: make(s3) })).toThrow(refusal);
    expect(() => Bun.spawn({ ...options, stdio: [make(s3), "ignore", "ignore"] })).toThrow(refusal);
    expect(() => Bun.spawnSync({ ...options, stdin: make(s3) })).toThrow(refusal);
    expect(() => Bun.spawnSync({ ...options, stdio: [make(s3), "ignore", "ignore"] })).toThrow(refusal);
    expect(await s3.requestsAfterOneRead()).toEqual(["GET /bucket/after"]);
  });

  test("is refused for stdout and for stdio[3] like an in-memory Blob", async () => {
    using s3 = s3StandIn();
    const cmd = [bunExe(), "-e", ""];
    expect(() => Bun.spawn({ cmd, env: bunEnv, stdout: s3.file() as any })).toThrow(
      "Blobs are immutable, and cannot be used for stdout/stderr",
    );
    expect(() => Bun.spawn({ cmd, env: bunEnv, stdio: ["ignore", "ignore", "ignore", s3.file() as any] })).toThrow(
      "Blob cannot be used for stdio[3] yet",
    );
    expect(await s3.requestsAfterOneRead()).toEqual(["GET /bucket/after"]);
  });

  test("the child reads the object from await blob.bytes()", async () => {
    using s3 = s3StandIn();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      env: bunEnv,
      stdin: await s3.file().bytes(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "from-s3", stderr: "", exitCode: 0 });
    expect(s3.requests).toEqual(["GET /bucket/key"]);
  });

  // `new Response([blob])` moves the bytes out of `blob` and leaves its size. On the pipe path (memfd off, or any
  // platform but Linux) a stdin with a size and no bytes was a pipe that never closed.
  test.concurrent.each(["spawn", "spawnSync"])(
    "Bun.%s gives the child what a Blob holds after its bytes moved out, and the child ends",
    async method => {
      const collect =
        method === "spawnSync"
          ? `[proc.stdout.toString(), proc.exitCode]`
          : `await Promise.all([proc.stdout.text(), proc.exited])`;
      const fixture = `
        const blob = new Blob(["0123456789"]);
        new Response([blob]);
        const held = await blob.text();
        const proc = Bun.${method}({
          cmd: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
          stdin: blob,
          stdout: "pipe",
          stderr: "inherit",
        });
        const [stdout, exitCode] = ${collect};
        console.log(JSON.stringify({ childReadWhatTheBlobHolds: stdout === held, exitCode }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: JSON.stringify({ childReadWhatTheBlobHolds: true, exitCode: 0 }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  // An extra slot refuses a Blob that has a size, so it does not take this one for an empty Blob.
  test("a Blob is refused for stdio[3] after its bytes moved out", () => {
    const blob = new Blob(["0123456789"]);
    new Response([blob] as any);
    const options = { cmd: [bunExe(), "-e", ""], env: bunEnv, stdio: ["ignore", "ignore", "ignore", blob] } as any;
    expect(() => Bun.spawn(options)).toThrow("Blob cannot be used for stdio[3] yet");
    expect(() => Bun.spawnSync(options)).toThrow("Blob cannot be used for stdio[3] yet");
  });
});
