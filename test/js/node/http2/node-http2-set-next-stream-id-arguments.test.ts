// Every HTTP/2 session has a getter named Symbol.for("::bunhttp2native::") that
// returns its native session object. session.setNextStreamID(id) checks the id
// and then calls the native setNextStreamID(id), but script can call the native
// method itself. With no argument it read past the end of the argument list,
// which ended the process with
// "panic: index out of bounds: the len is 0 but the index is 0".
// The fixture runs in a subprocess because that failure kills the process.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

test(
  "native setNextStreamID throws when the stream id is missing or is not a number",
  async () => {
    const fixture = /* js */ `
      const http2 = require("node:http2");
      const { Duplex } = require("node:stream");

      const socket = new Duplex({
        write(chunk, encoding, callback) {
          callback();
        },
        read() {},
      });
      const session = http2.performServerHandshake(socket);
      const native = session[Symbol.for("::bunhttp2native::")];
      const outcome = (...args) => {
        try {
          native.setNextStreamID(...args);
          return "returned";
        } catch (error) {
          return error.name + ": " + error.message;
        }
      };
      console.log(JSON.stringify({ missing: outcome(), string: outcome("3"), number: outcome(3) }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is not asserted. It is here so that a crash report shows in the diff.
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        JSON.stringify({
          missing: "Error: Expected stream_id to be a number",
          string: "Error: Expected stream_id to be a number",
          number: "returned",
        }) + "\n",
      stderr: expect.any(String),
      exitCode: 0,
    });
  },
  // A debug build needs about 3 s to load node:http2, which is near the default timeout.
  isDebug ? 30_000 : undefined,
);
