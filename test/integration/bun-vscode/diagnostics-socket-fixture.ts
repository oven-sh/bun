// Started by diagnostics-socket.test.ts. Each request prints three lines, then logs and throws an error
// that a built-in function made.
function target() {
  return new URL("not a url");
}

const server = Bun.serve({
  port: 0,
  fetch() {
    for (let i = 0; i < 3; i++) console.log("line " + i);
    try {
      return Response.redirect(target().href);
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
});
// The test is gone: do not stay behind.
process.on("disconnect", () => process.exit());
process.send!(server.url.href);
