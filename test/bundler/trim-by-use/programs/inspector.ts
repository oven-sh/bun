import inspector, { Session } from "node:inspector";
function codeOf(run: () => void): string {
  try {
    run();
    return "no error";
  } catch (error: any) {
    return error.code;
  }
}
console.log(inspector.url(), typeof inspector.open, typeof inspector.close, typeof inspector.console.log);
const session = new Session();
console.log(codeOf(() => session.post("Debugger.enable")));
session.connect();
console.log(
  codeOf(() => session.connect()),
  codeOf(() => session.post("Missing.method")),
);
session.disconnect();
console.log(codeOf(() => inspector.waitForDebugger()));
// The import and the names are there without the feature. This is the call that enters it: without --compile-inspector it starts nothing.
inspector.open(0);
console.log(inspector.url());
