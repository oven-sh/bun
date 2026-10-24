import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";

const BUN = bunExe();

test("$ with Bun.file prints the path", async () => {
  expect(await $`echo ${Bun.file(import.meta.path)}`.text()).toBe(`${import.meta.path}\n`);
  expect(await $`echo ${import.meta.path}`.text()).toBe(`${import.meta.path}\n`);
});

test("an S3-backed Blob in a command throws", async () => {
  // Stands in for S3 on the loopback, and records each request.
  const requests: string[] = [];
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      return new Response("hello from s3\n");
    },
  });
  const options = { endpoint: server.url.href, accessKeyId: "test", secretAccessKey: "test", bucket: "bucket" };
  const client = new Bun.S3Client(options);
  const file = () => client.file("key");
  const inputs: Record<string, () => unknown> = {
    "an S3File": file,
    "Bun.file() of an s3:// URL": () => Bun.file("s3://bucket/key", options as any),
    "a slice of an S3File": () => file().slice(0, 5),
    "a zero-length slice of an S3File": () => file().slice(0, 0),
    "a Blob made of one S3File": () => new Blob([file()]),
    "an array with an S3File": () => [file()],
  };
  // The tag reads the template when it is called. No script is awaited here, so no command runs.
  const thrown = (script: () => unknown) => {
    try {
      script();
      return "did not throw";
    } catch (error) {
      const { name, code, message } = error as Error & { code?: string };
      return { name, code, message };
    }
  };
  // The same name and code as the refusal of this Blob as the stdin of Bun.spawn.
  const refusal = {
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message:
      "An S3-backed Blob is not supported in a shell command yet. To redirect from it, pass its bytes: `< ${await blob.bytes()}`",
  };
  const outcomes: Record<string, unknown> = {};
  const expected: Record<string, unknown> = { "echo hi > an S3File": refusal, "echo an S3File": refusal };
  for (const cmd of ["cat", "echo", "true && cat", `${BUN} -e "process.stdin.pipe(process.stdout)"`]) {
    for (const [name, input] of Object.entries(inputs)) {
      outcomes[`${cmd} < ${name}`] = thrown(() => $`${{ raw: cmd }} < ${input()}`);
      expected[`${cmd} < ${name}`] = refusal;
    }
  }
  outcomes["echo hi > an S3File"] = thrown(() => $`echo hi > ${file()}`);
  outcomes["echo an S3File"] = thrown(() => $`echo ${file()}`);
  expect(outcomes).toEqual(expected);

  // The bytes, as the message says. A request that a call above started is in the list before this one.
  expect(await $`cat < ${await file().bytes()}`.text()).toBe("hello from s3\n");
  expect(requests).toEqual(["GET /bucket/key"]);
});

test("redirect from Bun.file(fd) reaches the command", async () => {
  using dir = tempDir("shell-fd-redirect", { "in.txt": "from an fd\n" });
  const fd = openSync(join(String(dir), "in.txt"), "r");
  try {
    expect(await $`echo hi < ${Bun.file(fd)}`.text()).toBe("hi\n");
    expect(await $`${BUN} -e "process.stdin.pipe(process.stdout)" < ${Bun.file(fd)}`.env(bunEnv).text()).toBe(
      "from an fd\n",
    );
  } finally {
    closeSync(fd);
  }
});

// `new Response([blob])` moves the bytes out of `blob` and leaves its size.
test("redirect from a Blob whose bytes moved out gives the command what the Blob holds", async () => {
  const blob = new Blob(["0123456789"]);
  new Response([blob] as any);
  const held = await blob.text();
  const result = await $`${BUN} -e ${"process.stdout.write(await Bun.stdin.text())"} < ${blob}`.env(bunEnv).nothrow();
  expect({
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  }).toEqual({ stdout: held, stderr: "", exitCode: 0 });
});
