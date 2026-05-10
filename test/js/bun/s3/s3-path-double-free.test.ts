import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When an S3 operation given a path string throws after constructing the
// internal blob (e.g. missing credentials), the path string must not be
// dereferenced twice. Previously both `defer blob.deinit()` and the outer
// `errdefer path.deinit()` fired, over-releasing the underlying StringImpl.
test("S3Client methods do not double-free the path string when they throw", () => {
  const { exitCode, stdout, stderr, signalCode } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
        process.on("unhandledRejection", () => {});
        const methods = ["presign", "exists", "size", "stat", "unlink", "delete"];

        for (const m of methods) {
          for (let i = 0; i < 3; i++) {
            try { Bun.S3Client[m]("some/key/here.txt"); } catch {}
            try { Bun.S3Client[m]("some/key/here.txt", "not an object"); } catch {}
          }
        }
        for (let i = 0; i < 3; i++) {
          try { Bun.S3Client.write("some/key/here.txt", "data", "not an object")?.catch?.(() => {}); } catch {}
        }

        const client = new Bun.S3Client({});
        for (const m of methods) {
          for (let i = 0; i < 3; i++) {
            try { client[m]("some/key/here.txt"); } catch {}
            try { client[m]("some/key/here.txt", "not an object"); } catch {}
          }
        }
        for (let i = 0; i < 3; i++) {
          try { client.write("some/key/here.txt", "data", "not an object")?.catch?.(() => {}); } catch {}
        }

        Bun.gc(true);
        console.log("ok");
      `,
    ],
    env: {
      ...bunEnv,
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stderr.toString()).not.toContain("panic");
  expect(signalCode).toBeFalsy();
  expect(stdout.toString().trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
