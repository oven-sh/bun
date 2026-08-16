// Exercise lazy process.stdin / process.stdout / process.stderr creation near
// the stack limit. The property callbacks that create these streams report the
// exception if stream construction fails with a stack overflow; that reporting
// path must not observe the exception as still pending when it re-enters JS
// to invoke the uncaughtException listener (Interpreter::executeCallImpl
// asserts no pending exception on entry).
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
