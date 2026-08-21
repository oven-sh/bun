// Spawned by spawn-stdin-pipe-fd-leak.test.ts in an empty cwd, with leak
// detection enabled and memfd disabled (on Linux, Bun.spawn would otherwise
// give the child a memfd instead of going through the writer this exercises;
// the shell redirect uses the writer regardless). Drives the writer that pumps
// a buffer into a child's stdin through both of its owners (Bun.spawn and the
// shell's `< ${buffer}` redirect) and both ways its write can end, then exits;
// LeakSanitizer reports whatever is still allocated at that point.
//
// In every "write fails" case the child closes its stdin without reading it,
// reports that, and stays alive until it is killed: the parent's next write
// to it fails with EPIPE while the child is still running, so the writer has
// to clean itself up from its own error path. (A child that simply exited
// would race that against the exit path, which also closes a writer it still
// finds in the stdin slot.)
import { $ } from "bun";

const N = 2;
// Larger than any pipe/socket buffer, so the writer is still mid-write when
// the child acts on its stdin.
const input = Buffer.alloc(1 << 20, 0x61);

// Bun.spawn, write fails.
{
  const children = Array.from({ length: N }, () =>
    Bun.spawn({
      cmd: ["sh", "-c", "exec 0<&-; echo closed; exec sleep 30"],
      stdin: input,
      stdout: "pipe",
      stderr: "inherit",
    }),
  );
  for (const child of children) {
    const { value } = await child.stdout.getReader().read();
    if (!new TextDecoder().decode(value).startsWith("closed"))
      throw new Error("child did not report closing its stdin");
  }
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exited));
}

// Bun.spawn, write drains.
{
  const exits = await Promise.all(
    Array.from(
      { length: N },
      () =>
        Bun.spawn({ cmd: ["sh", "-c", "exec cat >/dev/null"], stdin: input, stdout: "ignore", stderr: "inherit" })
          .exited,
    ),
  );
  if (exits.some(code => code !== 0)) throw new Error(`draining children exited with ${exits}`);
}

// Shell, write fails. The command reports its pid through a file, since the
// shell does not hand out its children. Shell promises are lazy: then()
// starts them.
{
  const commands = Array.from({ length: N }, (_, i) => {
    const script = `exec 0<&-; echo $$ > pid${i}.txt; exec sleep 30`;
    return $`sh -c ${script} < ${input}`
      .quiet()
      .nothrow()
      .then(() => {});
  });
  for (let i = 0; i < N; i++) {
    let pid = "";
    while (!pid.endsWith("\n")) {
      await Bun.sleep(5);
      pid = (await Bun.file(`pid${i}.txt`).exists()) ? await Bun.file(`pid${i}.txt`).text() : "";
    }
    process.kill(Number(pid), "SIGKILL");
  }
  await Promise.all(commands);
}

// Shell, write drains.
for (let i = 0; i < N; i++) await $`sh -c "exec cat >/dev/null" < ${input}`.quiet();
