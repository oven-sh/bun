// The processes that the tests of `bun lint`, `bun format` and `bun check` start.
//
// A test that runs out of time never gets to the end of its `await using`, and `bun test` ends what such a test has started only
// if the test ran alone: not in a concurrent group, where these tests are. A linter in an endless loop would run on, and when
// `bun test` is through, without a parent. So each has a limit of its own, and what is left at the end of the file is ended:
//
//     afterAll(endChildren);
import { isASAN, isDebug } from "harness";

const running = new Set<{ kill(signal: "SIGKILL"): void }>();

/** `Bun.spawn`. `timeout` can be set to less. */
export function spawn<
  const In extends Bun.SpawnOptions.Writable = "ignore",
  const Out extends Bun.SpawnOptions.Readable = "pipe",
  const Err extends Bun.SpawnOptions.Readable = "inherit",
>(options: Bun.SpawnOptions.SpawnOptions<In, Out, Err> & { cmd: string[] }): Bun.Subprocess<In, Out, Err> {
  const proc = Bun.spawn({ timeout: isDebug || isASAN ? 100_000 : 30_000, killSignal: "SIGKILL", ...options });
  running.add(proc);
  void proc.exited.then(() => running.delete(proc));
  return proc;
}

export function endChildren() {
  for (const proc of running) proc.kill("SIGKILL");
  running.clear();
}
