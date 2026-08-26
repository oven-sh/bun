// A socket callback can run the event loop re-entrantly: bun:test waits for
// `expect(promise).resolves` / `.rejects` synchronously, and the WebSocket open
// event fires from inside the native read callback of the client socket. When
// the server closes that connection and the nested run observes it, the
// client socket is closed while the outer read callback still holds it.
//
// uSockets defers freeing closed sockets to the outermost tick for exactly
// this case, but only the epoll/kqueue backend tracked the tick depth. The
// libuv backend (Windows) freed the socket from the nested run, and libuv then
// re-queued the endgame of the poll handle that the nested run had already
// closed. The fixture crashed (debug builds fault on mimalloc's freed-memory
// fill) or hung on Windows.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("a nested event loop inside the open callback may close the socket", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./websocket-close-during-nested-tick-fixture.ts"],
    env: bunEnv,
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Only the version banner goes to stdout. The results go to stderr, and a
  // crash in the child shows up there before the exit code assertion.
  expect(stdout).toStartWith("bun test v");
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "websocket-close-during-nested-tick-fixture.ts:
    (pass) server closes the socket while a nested event loop runs inside the open callback

     1 pass
     0 fail
     2 expect() calls
    Ran 1 test across 1 file."
  `);
  expect(exitCode).toBe(0);
});
