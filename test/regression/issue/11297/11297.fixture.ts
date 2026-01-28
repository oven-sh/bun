import { bunExe } from "harness";

const string = Buffer.alloc(1024 * 1024, "zombo.com\n").toString();
process.exitCode = 1;

const proc = Bun.spawn({
  cmd: [
    bunExe(),
    "-e",
    `
let length = 0;
process.stdin.on('data', (data) => length += data.length);
process.once('beforeExit', () => console.error(length));
process.stdin.pipe(process.stdout)
    `,
  ],
  stdio: ["pipe", "pipe", "inherit"],
});

const writer = (async function () {
  console.time("Sent " + string.length + " bytes x 10");
  for (let i = 0; i < 10; i += 1) {
    // TODO: investigate if the need for this "await" is a bug.
    // I believe FileSink should be buffering internally.
    //
    // To reproduce:
    //
    //   1. Remove "await" from proc.stdin.write(string) (keep the .end() await)
    //   2. Run `hyperfine "bun test/regression/issue/011297.fixture.ts"` (or run this many times on macOS.)
    //
    proc.stdin.write(string);
  }
  await proc.stdin.end();
  console.timeEnd("Sent " + string.length + " bytes x 10");
})();

const reader = (async function () {
  console.time("Read " + string.length + " bytes x 10");

  const chunks = [];
  for await (const chunk of proc.stdout) {
    chunks.push(chunk);
  }

  console.timeEnd("Read " + string.length + " bytes x 10");

  return chunks;
})();

const [chunks, exitCode] = await Promise.all([reader, proc.exited, writer]);
const combined = Buffer.concat(chunks).toString().trim();
if (combined !== string.repeat(10)) {
  await Bun.write("a.txt", string.repeat(10));
  await Bun.write("b.txt", combined);
  throw new Error(`string mismatch!
  exit code: ${exitCode}

  hash:
    input   ${Bun.SHA1.hash(string.repeat(10), "hex")}
    output: ${Bun.SHA1.hash(combined, "hex")}
  length:
    input   ${string.length * 10}
    output: ${combined.length}

`);
}

if (exitCode !== 0) {
  throw new Error("process exited with non-zero code");
}
console.timeEnd("Read " + string.length + " bytes x 10");
process.exitCode = 0;
