import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// What the accessors and methods on the prototype objects of the library answer for a receiver that is no instance of their class:
// `http.ServerResponse.prototype.headersSent`, `Readable.prototype.destroy.call({})`. Whoever walks a prototype object and reads
// its members meets these answers: a mocking library, an inspector that runs getters. A change here is a change of behavior: compare
// it with Node.js before updating the snapshot. A prototype object is entered under the first module of the list that leads to it.
const modules = [
  "node:events",
  "node:stream",
  "node:string_decoder",
  "node:net",
  "node:tls",
  "node:http",
  "node:https",
  "node:http2",
  "node:dgram",
  "node:dns",
  "node:fs",
  "node:child_process",
  "node:cluster",
  "node:crypto",
  "node:zlib",
  "node:readline",
  "node:readline/promises",
  "node:repl",
  "node:tty",
  "node:url",
  "node:util",
  "node:assert",
  "node:async_hooks",
  "node:diagnostics_channel",
  "node:worker_threads",
  "node:inspector",
  "node:console",
  "node:test",
  "node:v8",
  "node:wasi",
  "bun:sqlite",
  "bun:ffi",
];

test.each(modules)(
  "members of the prototype objects of %s",
  async id => {
    using dir = tempDir("any-receiver", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "members-of-prototype-objects-for-any-receiver-fixture.js"),
        id,
        ...modules.slice(0, modules.indexOf(id)),
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // On Windows setRawMode() goes through the handle of the stream, elsewhere through the file descriptor.
    if (isWindows && id === "node:tty") expect(stdout).toMatchSnapshot("on Windows");
    else expect(stdout).toMatchSnapshot();
    expect(exitCode).toBe(0);
  },
  60_000,
);
