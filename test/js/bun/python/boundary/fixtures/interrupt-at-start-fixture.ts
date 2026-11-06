// Python is first used in a script of node:vm that SIGINT breaks, most likely while the interpreter is being made. Whenever the
// signal arrives, what is done once, at the first use, has been done afterwards.
import vm from "node:vm";

let code = "returned";
try {
  vm.runInContext(
    `process.kill(process.pid, "SIGINT"); require("python:sys"); for (;;);`,
    vm.createContext({ process, require }),
    { breakOnSigint: true },
  );
} catch (error: any) {
  code = error.code;
}
console.log(code);
// Not an import: this is not to be the first use.
const { dict, exec } = require("python:builtins");
exec(`import sys\nprint(sys.argv, repr(sys.path[0]), flush=True)`, dict());
