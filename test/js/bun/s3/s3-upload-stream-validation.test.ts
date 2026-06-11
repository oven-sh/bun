import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/32125
// A locked ReadableStream body used to reach ResumableSink's synchronous
// failure path before upload_stream wired the task's callback context,
// crashing the process (null context re-entry). It must instead settle the
// fetch promise the same way other S3 upload failures do: a 500 Response
// carrying the error code and message.
test("fetch s3:// with a locked ReadableStream body fails cleanly instead of crashing", async () => {
  const script = `
    const s3 = { accessKeyId: "a", secretAccessKey: "b", endpoint: "http://127.0.0.1:1", bucket: "bucket" };
    const results = [];
    for (const method of ["PUT", "POST"]) {
      const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); } });
      stream.getReader(); // lock it, don't read
      const res = await fetch("s3://bucket/key.txt", { method, body: stream, s3 });
      results.push({ method, status: res.status, statusText: res.statusText, body: await res.text() });
    }
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let results: unknown;
  try {
    results = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`child crashed or produced no result.\nstdout: ${stdout}\nstderr: ${stderr}\nexit: ${exitCode}`);
  }
  expect(results).toEqual([
    {
      method: "PUT",
      status: 500,
      statusText: "ERR_STREAM_CANNOT_PIPE",
      body: "Stream already used, please create a new one",
    },
    {
      method: "POST",
      status: 500,
      statusText: "ERR_STREAM_CANNOT_PIPE",
      body: "Stream already used, please create a new one",
    },
  ]);
  expect(exitCode).toBe(0);
});

test("fetch s3:// with an already-used ReadableStream body still throws synchronously", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(4));
      c.close();
    },
  });
  await stream.getReader().read(); // disturb it
  expect(() => {
    fetch("s3://bucket/key.txt", {
      method: "PUT",
      body: stream,
      s3: { accessKeyId: "a", secretAccessKey: "b", endpoint: "http://127.0.0.1:1", bucket: "bucket" },
    });
  }).toThrow("ReadableStream has already been used");
});
