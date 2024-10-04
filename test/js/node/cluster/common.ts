import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import util from "node:util";

export const isWindows = process.platform === "win32";

export function tmpdirSync(pattern: string = "bun.test.") {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), pattern));
}

export function isAlive(pid) {
  try {
    process.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

export function mustNotCall(msg?) {
  return function mustNotCall(...args) {
    const argsInfo = args.length > 0 ? `\ncalled with arguments: ${args.map(arg => util.inspect(arg)).join(", ")}` : "";
    assert.fail(`${msg || "function should not have been called"} ` + argsInfo);
  };
}

export function patchEmitter(emitter: any, prefix: string) {
  var oldEmit = emitter.emit;

  emitter.emit = function () {
    console.log([prefix, arguments[0]]);
    oldEmit.apply(emitter, arguments);
  };
}
