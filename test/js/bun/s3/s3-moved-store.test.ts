import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// User JS can move the native store out of an S3 file, into a body: an array
// body (`new Response([file])`), or the body of `server.fetch(url, { body })`.
// A collection frees the store when nothing keeps that body. Three S3 methods
// read the store after user JS can do that: stat() with no test for a missing
// store, unlink() and presign() after their option getters ran. Without the
// fix, stat() and unlink() kill the process, and presign() reads freed memory
// and can sign the key of another file.
//
// Each form runs in a process of its own (s3-moved-store-fixture.ts). The S3
// endpoint is a server in this process that records the requests.

const fixture = path.join(import.meta.dir, "s3-moved-store-fixture.ts");
const key = "own-key-" + Buffer.alloc(200, "k").toString();
const ownPath = `/bucket/${key}`;

async function run(form: string, road = "") {
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
    cmd: [bunExe(), fixture, form, key, road],
    env: { ...bunEnv, S3_ENDPOINT: server.url.href },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, requests, exitCode };
}

type Case = [form: string, result: unknown, requests: string[]];

// The store stays in the file.
const controls: Case[] = [
  ["stat", { size: 5 }, [`HEAD ${ownPath}`]],
  ["unlink", "deleted", [`DELETE ${ownPath}`]],
  ["presign", ownPath, []],
];

// The store moves out of the file before the call, or in the middle of it.
const moved: Case[] = [
  // Control: writer() takes its own reference to the store before a getter runs.
  ["writer, a getter moves the store", 5, [`PUT ${ownPath}`]],
  ["stat, store moved", { rejected: "ERR_INVALID_THIS" }, []],
  ["unlink, a getter moves the store", "deleted", [`DELETE ${ownPath}`]],
  ["presign, a getter moves and frees the store", ownPath, []],
];

async function check(form: string, result: unknown, requests: string[], road?: string) {
  const { stdout, stderr, exitCode, requests: received } = await run(form, road);
  // stderr is included only so it appears in the toEqual diff on failure.
  expect({ stderr, stdout, requests: received }).toEqual({
    stderr: expect.any(String),
    stdout: JSON.stringify({ result }),
    requests,
  });
  expect(exitCode).toBe(0);
}

describe.concurrent("S3 file that keeps its store", () => {
  test.each(controls)("%s", (form, result, requests) => check(form, result, requests));
});

// #38503 removes both roads. Each is probed, so that its cases skip with a
// reason in the title instead of asserting a state that no longer exists.
const roads = ["an array body", "the body of server.fetch()"];
const probes = await Promise.all(roads.map(road => run("probe", road)));

describe.each(roads.map((road, i) => [road, probes[i]] as const))(
  "S3 file whose store moves into %s",
  (road, probe) => {
    const emptiesTheFile = probe.stdout === JSON.stringify({ result: true });

    // The skip below is for one answer only: a probe that ended by itself and
    // said the file kept its store. A probe that died or printed anything else
    // fails here, so it cannot skip the cases in silence.
    test("the probe says if this road empties the file", () => {
      // stderr is included only so it appears in the toEqual diff on failure.
      expect({ stderr: probe.stderr, stdout: probe.stdout, requests: probe.requests }).toEqual({
        stderr: expect.any(String),
        stdout: JSON.stringify({ result: emptiesTheFile }),
        requests: [],
      });
      expect(probe.exitCode).toBe(0);
    });

    describe.concurrent.skipIf(!emptiesTheFile)("while this road empties the file", () => {
      test.each(moved)("%s", (form, result, requests) => check(form, result, requests, road));
    });
  },
);
