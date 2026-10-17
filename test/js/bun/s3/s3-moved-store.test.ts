import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// `new Response([file])` moves the native store out of an S3 file, into the
// body of the Response. A collection frees the store when nothing keeps that
// Response. Three S3 methods read the store after user JS can do that: stat()
// with no test for a missing store, unlink() and presign() after their option
// getters ran. Without the fix, stat() and unlink() kill the process, and
// presign() reads freed memory and can sign the key of another file.
//
// Each form runs in a process of its own (s3-moved-store-fixture.ts). The S3
// endpoint is a server in this process that records the requests.

const fixture = path.join(import.meta.dir, "s3-moved-store-fixture.ts");
const key = "own-key-" + Buffer.alloc(200, "k").toString();
const ownPath = `/bucket/${key}`;

async function run(form: string) {
  const requests: string[] = [];
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(`${req.method} ${new URL(req.url).pathname}`);
      if (req.method === "HEAD") return new Response(null, { headers: { "content-length": "5" } });
      return new Response(null, { status: req.method === "DELETE" ? 204 : 200 });
    },
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, form, key],
    env: { ...bunEnv, S3_ENDPOINT: server.url.href },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, requests, exitCode };
}

type Case = [form: string, result: unknown, requests: string[]];

// The store stays in the file, or the method keeps its own reference to it.
const controls: Case[] = [
  ["stat", { size: 5 }, [`HEAD ${ownPath}`]],
  ["unlink", "deleted", [`DELETE ${ownPath}`]],
  ["presign", ownPath, []],
  ["writer, a getter moves the store", 5, [`PUT ${ownPath}`]],
];

// The store moves out of the file before the call, or in the middle of it.
const moved: Case[] = [
  ["stat, store moved", { rejected: "ERR_INVALID_THIS" }, []],
  ["unlink, a getter moves the store", "deleted", [`DELETE ${ownPath}`]],
  ["presign, a getter moves and frees the store", ownPath, []],
];

async function check(form: string, result: unknown, requests: string[]) {
  const { stdout, stderr, exitCode, requests: received } = await run(form);
  // stderr is included only so it appears in the toEqual diff on failure.
  expect({ stderr, stdout, requests: received }).toEqual({
    stderr: expect.any(String),
    stdout: JSON.stringify({ result }),
    requests,
  });
  expect(exitCode).toBe(0);
}

// `new Response([file])` is the only road user JS has to empty a Blob, and
// #38503 removes it. Probe it, so that the three cases below skip with a
// reason in the title instead of asserting a state that no longer exists.
const { stdout: probe } = await run("probe");
const moveEmptiesTheFile = probe === JSON.stringify({ result: true });

describe.concurrent("S3 file that keeps its store", () => {
  test.each(controls)("%s", (form, result, requests) => check(form, result, requests));
});

describe.concurrent.skipIf(!moveEmptiesTheFile)(
  "S3 file whose store moves into a Response (skipped when an array body no longer moves it)",
  () => {
    test.each(moved)("%s", (form, result, requests) => check(form, result, requests));
  },
);
