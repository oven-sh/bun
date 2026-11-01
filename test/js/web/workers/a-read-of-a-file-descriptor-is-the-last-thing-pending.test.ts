import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(files: Record<string, string>) {
  using dir = tempDir("read-of-a-file-descriptor", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const startsWorker = `
  const worker = new Worker(new URL("./worker.js", import.meta.url));
  worker.addEventListener("error", event => console.log("error:", event.message));
  worker.addEventListener("close", event => console.log("closed", event.code));
`;

describe.concurrent("a read of a file that closes nothing is the last thing pending", () => {
  test("a Worker goes on behind a top-level await of Bun.stdin", async () => {
    expect(
      await run({
        "main.js": startsWorker,
        "worker.js": `
          console.log("text", JSON.stringify(await Bun.stdin.text()));
          console.log("bytes", (await Bun.stdin.bytes()).length);
          console.log("arrayBuffer", (await Bun.stdin.arrayBuffer()).byteLength);
        `,
      }),
    ).toEqual({ stdout: 'text ""\nbytes 0\narrayBuffer 0\nclosed 0\n', stderr: "", exitCode: 0 });
  });

  test("a Worker goes on behind a top-level await of a file that it opened itself", async () => {
    expect(
      await run({
        "main.js": startsWorker,
        "data.txt": "what the file holds",
        "worker.js": `
          import { closeSync, openSync } from "node:fs";
          const descriptor = openSync(new URL("./data.txt", import.meta.url), "r");
          console.log(await Bun.file(descriptor).text());
          closeSync(descriptor);
        `,
      }),
    ).toEqual({ stdout: "what the file holds\nclosed 0\n", stderr: "", exitCode: 0 });
  });

  test("a Worker goes on behind a top-level await of a file that is not there", async () => {
    expect(
      await run({
        "main.js": startsWorker,
        "worker.js": `
          console.log(await Bun.file(new URL("./not-there.txt", import.meta.url)).text().catch(error => error.code));
        `,
      }),
    ).toEqual({ stdout: "ENOENT\nclosed 0\n", stderr: "", exitCode: 0 });
  });

  test("a Worker runs a reaction that nothing awaits", async () => {
    expect(
      await run({
        "main.js": startsWorker,
        "worker.js": `Bun.stdin.text().then(text => console.log("then", JSON.stringify(text)));`,
      }),
    ).toEqual({ stdout: 'then ""\nclosed 0\n', stderr: "", exitCode: 0 });
  });

  test("the main thread runs a reaction that nothing awaits", async () => {
    expect(
      await run({
        "main.js": `Bun.stdin.text().then(text => console.log("then", JSON.stringify(text)));`,
      }),
    ).toEqual({ stdout: 'then ""\n', stderr: "", exitCode: 0 });
  });
});
