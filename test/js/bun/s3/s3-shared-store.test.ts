import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `new Response([file])` shares the native store of an S3 file with the body. The file keeps its store, also when an option getter makes the body in the middle of a call.
const prelude = `
const key = "own-key-" + Buffer.alloc(200, "k");
const client = new Bun.S3Client({ accessKeyId: "a", secretAccessKey: "b", bucket: "bucket", endpoint: process.env.S3_ENDPOINT });
const file = client.file(key);
const share = () => void new Response([file]);
const others = [];
const shareAndCollect = () => {
  share();
  for (let i = 0; i < 4; i++) Bun.gc(true);
  for (let i = 0; i < 8; i++) others.push(client.file("other-" + i + "-" + Buffer.alloc(200, "z")));
};
const stat = () => file.stat().then(stat => typeof stat.size, error => error.code);
`;

describe.concurrent("S3 file that is a part of a Response body", () => {
  test.each([
    ["stat() resolves after the file was a body part", `share(); console.log(await stat());`, "number"],
    [
      "unlink() deletes the file when an option getter makes a body of it",
      `await file.unlink({ get accessKeyId() { share(); return "a"; } }); console.log("deleted", await stat());`,
      "deleted number",
    ],
    [
      "presign() signs the key when an option getter makes a body of it and the body is collected",
      `console.log(new URL(file.presign({ get method() { shareAndCollect(); return "GET"; } })).pathname === "/bucket/" + key, await stat());`,
      "true number",
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
