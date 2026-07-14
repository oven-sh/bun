import { expect } from "bun:test";
let nested = false;
let got = "";
// Register the pidfd polls and let them become ready BEFORE stdin's poll is
// registered: Linux epoll appends to the ready list in readiness order, so
// stdin sits AFTER the pidfd that triggers the nested tick.
const N = 20;
for (let i = 0; i < N; i++) {
  Bun.spawn({
    cmd: ["/bin/true"],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    onExit() {
      if (!nested) {
        nested = true;
        // Bun.sleep resolves via the timer queue, which only drains inside
        // autoTick() after us_loop_run_bun_tick: waitForPromise must re-enter
        // epoll_wait, overwriting the outer dispatch's ready_polls.
        expect(Bun.sleep(1)).resolves.toBe(undefined);
      }
    },
  });
}
// First spin: give /bin/true time to exit so the pidfds are already on the
// epoll ready list before stdin is registered.
{
  const until = Date.now() + 20;
  while (Date.now() < until) {}
}
process.stdin.on("data", d => {
  got += d.toString();
  if (got.includes("X")) {
    process.stdout.write("GOT:" + got + "\n");
    process.exit(0);
  }
});
process.stdin.resume();
process.stdout.write("READY\n");
// Second spin: give the parent time to write "X" so stdin is appended to the
// ready list after the pidfds, then drain everything in one epoll_wait.
{
  const until = Date.now() + 80;
  while (Date.now() < until) {}
}
