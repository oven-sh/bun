// process.stdout and process.stderr are made at their first read. What writes for them, Bun.file(fd).writer(), takes a descriptor of its own, and a process that has
// opened as many files as it may gets none (EMFILE). The constructor of fs.WriteStream catches that and writes to the descriptor that it was given. The two smaller
// streams of a compiled program did not: the mere read of process.stderr threw, or the first write did, just where a program wants to say that it is out of descriptors.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const untilNoneIsLeft = `const fs = require("node:fs");
const held = [];
let code = "none";
try {
  for (;;) held.push(fs.openSync(process.execPath, "r"));
} catch (error) {
  code = error.code;
}
const seen = [];
let callbacks = 0;
`;

const touchBoth = `
try {
  const stream = process.stderr;
  seen.push("read stderr");
  seen.push(String(stream.write("to stderr: " + code + "\\n", () => callbacks++)));
  seen.push(String(stream.write(new Uint8Array([98, 121, 116, 101, 115, 10]))));
} catch (error) {
  seen.push("stderr threw " + error.code);
}
try {
  const stream = process.stdout;
  seen.push("read stdout");
  seen.push(String(stream.write("to stdout: " + code + "\\n", () => callbacks++)));
  seen.push(String(stream.write(new Uint8Array([98, 121, 116, 101, 115, 10]))));
  seen.push(String(stream.write("\\u00e9\\ud83d\\ude00\\n")));
} catch (error) {
  seen.push("stdout threw " + error.code);
}
`;

const programs = {
  // The program asks the streams for write() alone, so it has the light streams.
  "light.js": `${untilNoneIsLeft}${touchBoth}
for (const fd of held) fs.closeSync(fd);
setTimeout(() => {
  process.stdout.write(seen.join(" | ") + " | callbacks " + callbacks + "\\n");
  process.stderr.write("stderr, with descriptors again\\n");
}, 20);
`,
  // The program names neither stream: text that is evaluated at run time does, and gets the bare streams.
  "bare.js": `${untilNoneIsLeft}
const count = () => callbacks++;
new Function("code", "seen", "count", ${JSON.stringify(touchBoth.replaceAll("() => callbacks++", "count"))})(code, seen, count);
for (const fd of held) fs.closeSync(fd);
setTimeout(() => {
  new Function("line", "process.stdout.write(line); process.stderr.write('stderr, with descriptors again\\\\n');")(seen.join(" | ") + " | callbacks " + callbacks + "\\n");
}, 20);
`,
};

const withFewDescriptors = (command: string[]) => ["sh", "-c", 'ulimit -n 48; exec "$@"', "sh", ...command];

for (const entry of Object.keys(programs) as (keyof typeof programs)[]) {
  // A process on Windows does not run out of descriptors this way.
  test.skipIf(!!unsupported || isWindows)(
    `${entry}: a standard stream that is first touched when no descriptor is left writes all the same`,
    async () => {
      await slot(async () => {
        using dir = tempDir("aot-stream-without-a-descriptor", { [entry]: programs[entry] });
        const folder = String(dir);
        const executable = join(folder, "entry");
        const plain = await spawned(withFewDescriptors([bunExe(), "run", entry]), folder, bunEnv);
        expect(plain.stdout).toStartWith("to stdout: EMFILE\nbytes\n");
        expect(plain.stderr).toStartWith("to stderr: EMFILE\nbytes\n");
        built(await spawned([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], folder, bunEnv));
        const ran = await spawned(withFewDescriptors([executable]), folder, bunEnv);
        expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
          stdout: plain.stdout,
          stderr: plain.stderr,
          exitCode: 0,
          signal: null,
        });
      });
    },
    240_000,
  );
}
