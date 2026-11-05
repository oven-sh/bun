// A function of the host that is handed an object where it wants a text or a number refuses by a TypeError, and the message says what it got: "Received an instance of Made". To say so it asks the operand
// for its constructor and that for its name: code of the program, if the program has laid a getter there. Once the build left such a getter out ("nobody reads it"), and the program caught another error.
// Every function that refuses so, told over the ways in which a program answers for the name.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A call that plain Bun refuses by the type of OPERAND. */
const calls: Record<string, string> = {
  "process-chdir": `process.chdir(OPERAND)`,
  "process-kill": `process.kill(OPERAND)`,
  "process-umask": `process.umask(OPERAND)`,
  "process-emit-warning": `process.emitWarning(OPERAND)`,
  "process-hrtime": `process.hrtime(OPERAND)`,
  "process-set-uncaught-exception-capture-callback": `process.setUncaughtExceptionCaptureCallback(OPERAND)`,
  "process-next-tick": `process.nextTick(OPERAND)`,
  "process-setuid": `process.setuid(OPERAND)`,
  "process-setgid": `process.setgid(OPERAND)`,
  "process-seteuid": `process.seteuid(OPERAND)`,
  "process-setegid": `process.setegid(OPERAND)`,
  "process-initgroups": `process.initgroups(OPERAND, OPERAND)`,
  "process-set-source-maps-enabled": `process.setSourceMapsEnabled(OPERAND)`,
  "buffer-from": `Buffer.from(OPERAND)`,
  "buffer-alloc": `Buffer.alloc(OPERAND)`,
  "buffer-byte-length": `Buffer.byteLength(OPERAND)`,
  "buffer-concat": `Buffer.concat(OPERAND)`,
  "buffer-compare": `Buffer.compare(OPERAND, OPERAND)`,
  "buffer-write": `Buffer.alloc(1).write(OPERAND)`,
  "fs-read-file-sync": `require("node:fs").readFileSync(OPERAND)`,
  "fs-exists-sync": `require("node:fs").accessSync(OPERAND)`,
  "fs-close-sync": `require("node:fs").closeSync(OPERAND)`,
  "path-join": `require("node:path").join(OPERAND)`,
  "path-basename": `require("node:path").basename(OPERAND)`,
  "os-set-priority": `require("node:os").setPriority(OPERAND)`,
  "url-file-url-to-path": `require("node:url").fileURLToPath(OPERAND)`,
  "util-inherits": `require("node:util").inherits(OPERAND, OPERAND)`,
  "util-promisify": `require("node:util").promisify(OPERAND)`,
  "events-on": `new (require("node:events"))().on("made-up", OPERAND)`,
  "events-set-max-listeners": `new (require("node:events"))().setMaxListeners(OPERAND)`,
  "timers-set-timeout": `setTimeout(OPERAND, 1)`,
  "queue-microtask": `queueMicrotask(OPERAND)`,
  "crypto-random-bytes": `require("node:crypto").randomBytes(OPERAND)`,
  "crypto-create-hash": `require("node:crypto").createHash(OPERAND)`,
  "zlib-gzip-sync": `require("node:zlib").gzipSync(OPERAND)`,
  "child-process-spawn-sync": `require("node:child_process").spawnSync(OPERAND)`,
  "string-decoder": `new (require("node:string_decoder").StringDecoder)(OPERAND)`,
  "text-decoder-decode": `new TextDecoder().decode(OPERAND)`,
  "bun-file": `Bun.file(OPERAND)`,
  "bun-spawn-sync": `Bun.spawnSync(OPERAND)`,
  "bun-which": `Bun.which(OPERAND)`,
};

/** How the program answers for the name. Each says "asked" when it is asked. */
const operands: Record<string, [before: string, operand: string]> = {
  "a-static-getter-of-the-name": [
    `class Made {\n  static get name() {\n    console.log("asked");\n    return "Made";\n  }\n}\n`,
    `new Made()`,
  ],
  "a-getter-of-the-tag": [
    `class Made {\n  get [Symbol.toStringTag]() {\n    console.log("asked");\n    return "Made";\n  }\n}\n`,
    `new Made()`,
  ],
  "a-getter-of-the-constructor": [
    `class Made {}\nconst made = Object.create({\n  get constructor() {\n    console.log("asked");\n    return Made;\n  },\n});\n`,
    `made`,
  ],
  "a-plain-class": [`class Made {}\n`, `new Made()`],
};

export default function write(folder: string) {
  for (const [call, text] of Object.entries(calls))
    for (const [way, [before, operand]] of Object.entries(operands))
      writeFileSync(
        join(folder, `${call}--${way}.cjs`),
        `"use strict";\n${before}try {\n  ${text.replaceAll("OPERAND", operand)};\n  console.log("taken");\n} catch (error) {\n  console.log(error.name, error.code, "|", String(error.message).slice(0, 200));\n}\nprocess.exit(0);\n`,
      );
}
