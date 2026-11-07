// Runs each form of a redirect to a `Bun.file()` slice once and prints the results as JSON.
// The cwd has `f.txt` ("abcdefghij"), `sub/rel.txt` ("0123456789") and `big.bin`.
// `cat` reads the slice. It is a spawned command on POSIX and a builtin on Windows, or
// everywhere with BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1.
import { $ } from "bun";
import fs from "node:fs";
import path from "node:path";

$.nothrow();

const cwd = process.cwd();
const file = path.join(cwd, "f.txt");
const slice = (...range: number[]) => Bun.file(file).slice(...range);

async function run(command: () => ReturnType<typeof $>) {
  try {
    const { stdout, stderr, exitCode } = await command().quiet();
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString().replaceAll(cwd, "<cwd>").replaceAll("\\", "/"),
      exitCode,
    };
  } catch (e) {
    return { thrown: (e as Error).message };
  }
}

const big = path.join(cwd, "big.bin");
const bigBytes = fs.readFileSync(big);
const bigWindow: [number, number] = [1000, 1000 + 700 * 1024];

const results: Record<string, unknown> = {};

results["slice(2, 5)"] = await run(() => $`cat < ${slice(2, 5)}`);
results["slice(2)"] = await run(() => $`cat < ${slice(2)}`);
results["slice(0, 3)"] = await run(() => $`cat < ${slice(0, 3)}`);
results["slice(0, 0)"] = await run(() => $`cat < ${slice(0, 0)}`);
results["slice(20, 30)"] = await run(() => $`cat < ${slice(20, 30)}`);
results["slice(2, 5).slice(1, 2)"] = await run(() => $`cat < ${slice(2, 5).slice(1, 2)}`);
{
  const sized = Bun.file(file);
  sized.size;
  results["slice(-3) after .size"] = await run(() => $`cat < ${sized.slice(-3)}`);
  results["slice(2) after .size"] = await run(() => $`cat < ${sized.slice(2)}`);
  // Not slices: the whole file is still its path.
  results["echo of a whole file after .size"] = (await run(() => $`echo ${sized}`)).stdout === file + "\n";
  results["echo of .slice() after .size"] = (await run(() => $`echo ${sized.slice()}`)).stdout === file + "\n";
}
results["echo of .slice()"] = (await run(() => $`echo ${Bun.file(file).slice()}`)).stdout === file + "\n";
results["echo of a slice"] = await run(() => $`echo ${slice(2, 5)}`);

{
  const response = new Response(slice(2, 5));
  results["Response"] = await run(() => $`cat < ${response}`);
  results["Response: bodyUsed"] = response.bodyUsed;
}
results["structuredClone"] = await run(() => $`cat < ${structuredClone(slice(2, 5))}`);
results["in an array"] = await run(() => $`cat < ${[slice(2, 5)]}`);
{
  const twice = slice(2, 5);
  await run(() => $`cat < ${twice}`);
  results["second use of a slice"] = await run(() => $`cat < ${twice}`);
}
results["relative path and .cwd()"] = await run(() =>
  $`cat < ${Bun.file("rel.txt").slice(2, 5)}`.cwd(path.join(cwd, "sub")),
);
{
  // The tag reads nothing: the file does not exist yet.
  const later = path.join(cwd, "later.txt");
  const pending = $`cat < ${Bun.file(later).slice(2, 5)}`;
  fs.writeFileSync(later, "ABCDEFGHIJ");
  results["file written after the tag"] = await run(() => pending);
}
results["pipeline"] = await run(() => $`cat < ${slice(0, 4)} | cat`);
results["&& list"] = await run(() => $`cat < ${slice(0, 2)} && cat < ${slice(8)}`);
results["command substitution"] = await run(() => $`echo $(cat < ${slice(2, 5)})`);
results["command substitution, Buffer"] = await run(() => $`echo $(cat < ${Buffer.from("xyz")})`);
{
  const backtick = { raw: "`" };
  results["backtick substitution, Buffer"] = await run(() => $`echo ${backtick}cat < ${Buffer.from("xyz")}${backtick}`);
}
{
  const { stdout, exitCode } = await $`cat < ${Bun.file(big).slice(...bigWindow)}`.quiet();
  results["a window larger than a pipe buffer"] = {
    length: stdout.length,
    equal: bigBytes.subarray(...bigWindow).equals(stdout),
    exitCode,
  };
}

{
  const fd = fs.openSync(file, "r");
  const fdSlice = Bun.file(fd).slice(2, 5);
  results["fd slice"] = await run(() => $`cat < ${fdSlice}`);
  results["second use of an fd slice"] = await run(() => $`cat < ${fdSlice}`);
  results["Response over an fd slice"] = await run(() => $`cat < ${new Response(Bun.file(fd).slice(2, 5))}`);
  // The reads left the position of the descriptor at 0.
  const head = Buffer.alloc(4);
  const read = fs.readSync(fd, head, 0, 4, null);
  results["next read of the fd"] = head.subarray(0, read).toString();
  fs.closeSync(fd);
}

{
  const missing = path.join(cwd, "missing.txt");
  results["missing file"] = await run(() => $`cat < ${Bun.file(missing).slice(2, 5)}`);
  const response = new Response(Bun.file(missing).slice(2, 5));
  results["Response over a missing file"] = await run(() => $`cat < ${response}`);
  results["Response over a missing file: bodyUsed"] = response.bodyUsed;
  results["missing file exists"] = fs.existsSync(missing);
}

{
  // The second command throws while the first one reads its slice.
  results["script that fails during the read"] = await run(
    () => $`cat < ${Bun.file(big).slice(...bigWindow)} | echo hi > ${new Blob(["x"])}`,
  );
  results["slice after a failed script"] = await run(() => $`cat < ${slice(2, 5)}`);
}

{
  // `>` and `>>` to a slice write the file, as they do for `Bun.file(path)`.
  const out = path.join(cwd, "out.txt");
  fs.writeFileSync(out, "abcdefghij");
  results["> slice"] = await run(() => $`echo hi > ${Bun.file(out).slice(2, 5)}`);
  results["> slice: file"] = fs.readFileSync(out, "utf8");
  results[">> slice"] = await run(() => $`echo more >> ${Bun.file(out).slice(2, 5)}`);
  results[">> slice: file"] = fs.readFileSync(out, "utf8");
}

if (process.platform !== "win32") {
  // Not a regular file: the command reads the FIFO itself, to its end.
  const fifo = path.join(cwd, "fifo");
  Bun.spawnSync({ cmd: ["mkfifo", fifo] });
  const written = fs.promises.writeFile(fifo, "fifodata");
  results["FIFO slice"] = await run(() => $`cat < ${Bun.file(fifo).slice(2, 5)}`);
  await written;

  // The descriptor cannot be read.
  const fd = fs.openSync(file, fs.constants.O_WRONLY);
  results["slice of a write-only fd"] = await run(() => $`cat < ${Bun.file(fd).slice(2, 5)}`);
  fs.closeSync(fd);
}

console.log(JSON.stringify(results));
