import { bunEnv, bunExe } from "harness";

/** Echoes stdin to stdout until it is killed. */
export function echo() {
  return Bun.spawn({
    cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
}

/** Sends a line to an `echo()` process and returns what comes back. */
export async function roundTrip(proc: ReturnType<typeof echo>): Promise<string> {
  const reader = proc.stdout.getReader();
  try {
    proc.stdin.write("ping\n");
    proc.stdin.flush();
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
  } finally {
    reader.releaseLock();
  }
}

/** Runs until it is killed. */
export function idle() {
  return Bun.spawn({
    cmd: [bunExe(), "-e", "setInterval(() => {}, 1000)"],
    stdio: ["ignore", "ignore", "ignore"],
    env: bunEnv,
  });
}
