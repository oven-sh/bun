import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("S3Client preserves queueSize instead of forcing it to 255", () => {
  expect(Bun.inspect(new Bun.S3Client({ queueSize: 10 }))).toContain("queueSize: 10");
  expect(Bun.inspect(new Bun.S3Client({ queueSize: 1 }))).toContain("queueSize: 1");
  expect(Bun.inspect(new Bun.S3Client({ queueSize: 255 }))).toContain("queueSize: 255");
});

test("S3Client does not crash with queueSize > 255", () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
        for (const n of [256, 1000, 2147483647]) {
          const c = new Bun.S3Client({ queueSize: n });
          if (!Bun.inspect(c).includes("queueSize: 255")) {
            throw new Error("queueSize " + n + " was not clamped to 255");
          }
        }
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString().trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("S3Client throws RangeError with queueSize < 1", () => {
  expect(() => new Bun.S3Client({ queueSize: 0 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ queueSize: -1 })).toThrow(RangeError);
});

test("S3Client preserves transport options", () => {
  const client = new Bun.S3Client({
    maxSockets: 500,
    socketTimeout: 300_000,
    connectionTimeout: 5_000,
  });
  const inspected = Bun.inspect(client);
  expect(inspected).toContain("maxSockets: 500");
  expect(inspected).toContain("socketTimeout: 300000");
  expect(inspected).toContain("connectionTimeout: 5000");

  const file = client.file("key.txt");
  const inspectedFile = Bun.inspect(file);
  expect(inspectedFile).toContain("maxSockets: 500");
  expect(inspectedFile).toContain("socketTimeout: 300000");
  expect(inspectedFile).toContain("connectionTimeout: 5000");
});

test("S3Client throws RangeError with invalid transport options", () => {
  expect(() => new Bun.S3Client({ maxSockets: 0 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ maxSockets: -1 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ maxSockets: 65_536 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ socketTimeout: -1 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ socketTimeout: 4_294_967_296 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ connectionTimeout: -1 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ connectionTimeout: 4_294_967_296 })).toThrow(RangeError);
});

test("S3Client maxSockets limits concurrent S3 requests", async () => {
  let active = 0;
  let maxActive = 0;
  let seen = 0;
  const release = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    async fetch() {
      seen++;
      active++;
      maxActive = Math.max(maxActive, active);
      await release.promise;
      active--;
      return new Response(null, {
        status: 200,
        headers: {
          "content-length": "0",
          etag: '"test"',
        },
      });
    },
  });

  const client = new Bun.S3Client({
    endpoint: server.url.href,
    bucket: "bucket",
    accessKeyId: "test",
    secretAccessKey: "test",
    maxSockets: 1,
  });

  const requests = ["one.txt", "two.txt", "three.txt"].map(path => client.exists(path));

  for (let i = 0; i < 100 && seen === 0; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(seen).toBe(1);

  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(seen).toBe(1);
  expect(maxActive).toBe(1);

  release.resolve();
  expect(await Promise.all(requests)).toEqual([true, true, true]);
  expect(seen).toBe(3);
  expect(maxActive).toBe(1);
});
