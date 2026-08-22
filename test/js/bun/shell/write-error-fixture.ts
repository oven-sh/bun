// Spawned by epipe.test.ts with an fd 1 that rejects writes: the test either
// closes the read end of the stdout pipe (EPIPE) or opens /dev/full as stdout
// (ENOSPC). Every command below writes to that fd through the shell. The exit
// code and captured stderr of each one are written to results.json in the cwd,
// because fd 2 also receives whatever the shell echoes.
import { $ } from "bun";
import { existsSync, writeFileSync, writeSync } from "node:fs";

for (;;) {
  try {
    writeSync(1, "stdout still accepts writes\n");
  } catch (e: any) {
    if (e.code !== "EAGAIN") break;
  }
  await Bun.sleep(1);
}

writeFileSync("file", "contents\n");

const results: Record<string, unknown> = {};
async function run(name: string, command: ReturnType<typeof $>) {
  const { exitCode, stderr } = await command.nothrow();
  results[name] = [exitCode, stderr.toString()];
}

await run("true", $`true`);
await run("echo", $`echo hello`);
await run("pwd", $`pwd`);
await run("which", $`which sh`);
await run("seq", $`seq 3`);
await run("basename", $`basename /a/b`);
await run("dirname", $`dirname /a/b`);
await run("export", $`export`);
await run("yes", $`yes`);
await run("ls", $`ls .`);
// Reading a file operand in the cat builtin does not work on POSIX yet, so
// cat gets its input from a pipe; its exit code is the pipeline's.
await run("cat", $`echo hello | cat`);
await run("mkdir", $`mkdir -v dir`);
await run("rm", $`rm -v file`);
await run("external", $`${process.execPath} -e ${"console.log('relayed through the shell')"}`);
results["mkdir created dir"] = existsSync("dir");
results["rm removed file"] = !existsSync("file");

writeFileSync("results.json", JSON.stringify(results));
