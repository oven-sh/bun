// Exercise lazy process.stdin / process.stdout / process.stderr creation near
// the stack limit. Stream construction fails with a stack overflow there, which
// the property read throws (caught below). Nothing on that path may re-enter JS
// while the exception is pending (Interpreter::executeCallImpl asserts no
// pending exception on entry); an uncaughtException listener is what such a
// re-entry would call.
process.on("uncaughtException", () => {});
const which = process.argv[2];
function F(a, ...b) {
  if (!new.target) throw 0;
  const C = this.constructor;
  try {
    new C(a, F, this, this);
  } catch {}
  try {
    if (which === "stdin") void process.stdin;
    else if (which === "stdout") void process.stdout;
    else if (which === "stderr") void process.stderr;
    else if (which === "openStdin") process.openStdin();
  } catch {}
  process.reallyExit(0);
}
new F();
