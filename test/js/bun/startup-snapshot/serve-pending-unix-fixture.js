// Two pending servers on the same unix socket path: at restore the first binds, the second
// fails the way it would at startup, ending the launch before 'restore' listeners run.
const path = process.env.UNIX_PATH;
Bun.serve({ unix: path, fetch: () => new Response("a") });
Bun.serve({ unix: path, fetch: () => new Response("b") });
process.on("restore", () => {
  console.log("[js] restore ran"); // must not print: the duplicate bind fails first
});
if (Bun.startupSnapshot.isBuildingSnapshot()) Bun.startupSnapshot.take({ timers: "cancel" });
