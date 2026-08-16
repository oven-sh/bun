// server.ref()/unref() before the snapshot decide whether the server keeps a restored launch alive,
// exactly as they would after a normal listen. Nothing is bound while building, so the calls have
// to be carried over to the restore-time bind. The mode is read once, in the build, like the calls.
const reref = process.env.SERVE_REF_MODE === "reref";
const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
server.unref();
if (reref) server.ref(); // the last call wins, as after a normal listen
process.on("restore", () => {
  console.log("[js] restore port type:", typeof server.port); // bound before this listener ran
  // An unref'd timer only fires if something else keeps the loop alive: with the server unref'd
  // the process exits before it fires; with the server ref'd it fires and reports that.
  setTimeout(() => {
    console.log("[js] loop held open by the server");
    process.exit(reref ? 0 : 3);
  }, 50).unref();
});
