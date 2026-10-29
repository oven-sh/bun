// What a program can see of node:stream and node:events besides their answers: which properties of a stream they read and store, seen
// from an object below a Proxy and from accessors, what an error says when a member of a stream is not a function, and when the
// operators of Readable.prototype arrive. The expected files hold what each program printed before the modules were typed.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

const programs = join(import.meta.dir, "../../../aot/parallel/library-modules");

test.concurrent.each([
  ["stream-reads-seen-without-proxy-receiver", { STREAM_MEMBERS: "all" }],
  ["stream-members-replaced-by-not-function", { MESSAGES: "whole" }],
  ["stream-operators-arrive-with-first-pipe", {}],
])(
  "%s",
  async (name, env) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(programs, name + ".js")],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const expected = await Bun.file(join(import.meta.dir, name + ".expected.txt")).text();
    expect(stdout.split("\n")).toEqual(expected.split("\n"));
    expect(exitCode).toBe(0);
  },
  120_000,
);
