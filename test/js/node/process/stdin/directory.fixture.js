// fd 0 is a directory, so stdin cannot open. Prints what on("data") did and what the stream reported afterwards.
// With "web-first", a web consumer of Bun.stdin fails before process.stdin is touched.
let web = "skipped";
if (process.argv[2] === "web-first") {
  try {
    Bun.stdin.stream().getReader();
    web = "returned";
  } catch (e) {
    web = `threw ${e.code}/${e.syscall}`;
  }
}
let error = "none";
let attach;
try {
  process.stdin.on("error", e => {
    error = `${e.code}/${e.syscall}`;
  });
  process.stdin.on("data", () => {});
  attach = "attached";
} catch (e) {
  attach = `threw ${e.code ?? e.name}/${e.syscall}`;
}
// pause() then resume() drive the native source again. It has no descriptor to read.
process.stdin.pause();
process.stdin.resume();
process.on("exit", () => console.log(JSON.stringify({ web, attach, error })));
