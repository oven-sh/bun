// Run with `bun test`. A variant of the parent in ipc-last-message-fixture.ts with three children that are all dead
// before the event loop runs. Each child leaves a process behind that holds the channel open, so no EOF arrives.
// The ipc handler of the first child waits for the exit of that child inside a nested turn of the event loop
// (`expect(promise).resolves`), and that of the second child waits for its disconnect. Both have to come inside
// those turns, and whatever they run for the other children must not close a channel before the loop has read it.
import { afterAll, expect, test } from "bun:test";
import { childEnv, offTheLoopUntilTheExitIsPosted, quickChildWithHolder } from "./ipc-last-message-fixture.ts";

const events: string[][] = [[], [], []];
afterAll(() => console.log("EVENTS " + JSON.stringify(events)));

test("two ipc handlers wait for the exit and for the disconnect in a nested turn of the loop", async () => {
  const settled: Promise<unknown>[] = [];
  const children = events.map((seen, index) => {
    const disconnected = Promise.withResolvers<void>();
    const spawned = Bun.spawn({
      cmd: quickChildWithHolder,
      serialization: "json",
      env: childEnv(),
      stdio: ["ignore", "inherit", "inherit"],
      ipc(_message, subprocess) {
        seen.push("message");
        if (index === 0) expect(subprocess.exited).resolves.toBe(0);
        if (index === 1) expect(disconnected.promise).resolves.toBeUndefined();
      },
      onExit(_subprocess, exitCode, signalCode) {
        seen.push(`exit ${exitCode} ${signalCode}`);
      },
      onDisconnect() {
        seen.push("disconnect");
        disconnected.resolve();
      },
    });
    settled.push(spawned.exited, disconnected.promise);
    return spawned;
  });
  for (const spawned of children) offTheLoopUntilTheExitIsPosted(spawned.pid);
  await Promise.all(settled);
});
