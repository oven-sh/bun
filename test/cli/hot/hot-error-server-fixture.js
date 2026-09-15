// Spawned by hot.test.ts under --hot / --watch. Nothing edits files while it
// runs: the flag alone puts the process in watcher mode, where an unhandled
// error is supposed to be printed and otherwise change nothing. The routes let
// the test raise such errors and then check that the run loop still drives
// timers and still survives the next error.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    switch (new URL(req.url).pathname) {
      case "/timer":
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response("timer fired");
      case "/throw":
        queueMicrotask(() => {
          throw new Error("uncaught exception from /throw");
        });
        return new Response("alive");
      case "/reject":
        Promise.reject(new Error("unhandled rejection from /reject"));
        return new Response("alive");
      default:
        return new Response("alive");
    }
  },
});

switch (process.env.HOT_ERROR_FIXTURE) {
  case "entry-rejects":
    console.log(server.port);
    await 0;
    throw new Error("rejected by the entry point");
  case "idle":
    // With the server unref'd nothing keeps the loop alive once this module
    // finishes, so the run loop drains and dispatches beforeExit, then parks.
    // The unref'd server still answers while it is parked.
    server.unref();
    process.on("beforeExit", () => console.log("beforeExit"));
    console.log(server.port);
    break;
  default:
    console.log(server.port);
}
