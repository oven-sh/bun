// TEMPORARY, removed before this PR leaves draft: prints how many write
// requests (process.resourceUsage().fsWrite) each scenario costs the writing
// process, so that the numbers of two builds can be compared. Asserts nothing.
import { spawn } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const prelude = `
  const requests = () => process.resourceUsage().fsWrite;
  const drain = "for await (const chunk of Bun.stdin.stream()) {}";
  const child = stdin => Bun.spawn({ cmd: [process.execPath, "-e", drain], env: process.env, stdin, stdout: "ignore", stderr: "inherit" });
  const report = value => process.stderr.write("RESULT " + JSON.stringify(value) + "\\n");
  // 64 KiB first, then 2^32 + 64 KiB queued behind it.
  const queue = sink => {
    sink.write(new Uint8Array(64 * 1024));
    const piece = new Uint8Array(2 ** 28 + 4 * 1024);
    for (let i = 0; i < 16; i++) sink.write(piece);
  };
`;

export const scenarios = {
  "10000 x 64 KiB to a file sink": `
    const sink = Bun.file(process.env.OUT).writer();
    const chunk = new Uint8Array(64 * 1024);
    const before = requests();
    for (let i = 0; i < 10000; i++) { sink.write(chunk); await sink.flush(); }
    await sink.end();
    report(requests() - before);
  `,
  "10000 x 64 KiB to a child's stdin": `
    const proc = child("pipe");
    const chunk = new Uint8Array(64 * 1024);
    const before = requests();
    for (let i = 0; i < 10000; i++) { proc.stdin.write(chunk); await proc.stdin.flush(); }
    await proc.stdin.end();
    const after = requests();
    await proc.exited;
    report(after - before);
  `,
  "10000 x 1 KiB process.stdout.write to a file": `
    const chunk = Buffer.alloc(1024, 97);
    const before = requests();
    for (let i = 0; i < 10000; i++) process.stdout.write(chunk);
    await new Promise(resolve => process.stdout.write("", resolve));
    report(requests() - before);
  `,
  "stdin buffer of 2^32 bytes": `
    const before = requests();
    await child(new Uint8Array(2 ** 32)).exited;
    report(requests() - before);
  `,
  "stdin buffer of 0x7fff_f001 bytes": `
    const before = requests();
    await child(new Uint8Array(0x7fff_f001)).exited;
    report(requests() - before);
  `,
  "2^32 + 64 KiB queued on a child's stdin": `
    const proc = child("pipe");
    const before = requests();
    queue(proc.stdin);
    await proc.stdin.end();
    const after = requests();
    await proc.exited;
    report(after - before);
  `,
  "2^32 + 64 KiB queued on a file sink": `
    const sink = Bun.file(process.env.OUT).writer();
    const before = requests();
    queue(sink);
    await sink.end();
    report(requests() - before);
  `,
  "one 3 GiB write to a file sink": `
    const sink = Bun.file(process.env.OUT).writer();
    const before = requests();
    sink.write(new Uint8Array(3 * 2 ** 30));
    await sink.end();
    report(requests() - before);
  `,
};

export async function measure(names: (keyof typeof scenarios)[]) {
  const results: Record<string, unknown> = {};
  for (const name of names) {
    using dir = tempDir("measure-writes", {});
    await using proc = spawn({
      cmd: [bunExe(), "-e", prelude + scenarios[name]],
      env: { ...bunEnv, OUT: join(String(dir), "out.bin") },
      stdout: name.includes("process.stdout") ? Bun.file(join(String(dir), "stdout.bin")) : "ignore",
      stderr: "pipe",
      timeout: 150_000,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const line = stderr.match(/^RESULT (.*)$/m)?.[1];
    results[name] = line ? JSON.parse(line) : { stderr: stderr.slice(0, 300), exitCode, signalCode: proc.signalCode };
  }
  console.log("MEASURE " + JSON.stringify(results));
}
