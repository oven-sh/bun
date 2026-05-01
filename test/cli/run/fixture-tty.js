const onlyCheck = process.env.ONLY_CHECK_TTY === "0";
import { dlopen } from "bun:ffi";

const suffix = process.platform === "darwin" ? "dylib" : "so.6";
const { tcgetattr, tcsetattr } = dlopen(`libc.${suffix}`, {
  "tcgetattr": {
    "args": ["int", "pointer"],
    "result": "int",
  },
}).symbols;
var termios = new Buffer(256);
var dataView = new DataView(termios.buffer);
const rc = tcgetattr(0, dataView);
if (rc === 0) {
  throw new Error("tcgetattr failed");
}

await Bun.write(1, termios.toString("hex"));
