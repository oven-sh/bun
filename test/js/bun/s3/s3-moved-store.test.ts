import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `new Response([file])` moves the native store out of an S3 file. GC then frees the store along with the Response.
const prelude = `
const key = "own-key-" + Buffer.alloc(200, "k");
const client = new Bun.S3Client({ accessKeyId: "a", secretAccessKey: "b", bucket: "bucket", endpoint: process.env.S3_ENDPOINT });
const file = client.file(key);
const move = () => void new Response([file]);
const others = [];
const moveAndFree = () => {
  move();
  for (let i = 0; i < 4; i++) Bun.gc(true);
  for (let i = 0; i < 8; i++) others.push(client.file("other-" + i + "-" + Buffer.alloc(200, "z")));
};
`;

describe.concurrent("S3 file whose store moves into a Response", () => {
  test.each([
    ["stat() rejects after the move", `move(); console.log(await file.stat().catch(e => e.code));`, "ERR_INVALID_THIS"],
    [
      "unlink() deletes the file when an option getter moves the store",
      `await file.unlink({ get accessKeyId() { move(); return "a"; } }); console.log("deleted");`,
      "deleted",
    ],
    [
      "presign() signs the original key when an option getter moves and frees the store",
      `console.log(new URL(file.presign({ get method() { moveAndFree(); return "GET"; } })).pathname === "/bucket/" + key);`,
      "true",
    ],
  ])("%s", async (_, script, expected) => {
    using server = Bun.serve({
      port: 0,
      fetch: req => new Response(null, { status: req.method === "DELETE" ? 204 : 200 }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + script],
      env: { ...bunEnv, S3_ENDPOINT: server.url.href },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(expected);
    expect(exitCode).toBe(0);
  });
});
