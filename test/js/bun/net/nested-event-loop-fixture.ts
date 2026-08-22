// Spawned by socket.test.ts as `bun test <this file>`: it has to run under the
// test runner because expect(promise).resolves waits by driving the event loop
// synchronously, which is what nests event-loop ticks inside a socket's data
// callback while the dispatch for that socket is still on the stack.
import { expect, test } from "bun:test";

test("a socket closed inside its data callback survives nested event-loop ticks until the dispatch returns", async () => {
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write("x");
      },
      data() {},
    },
  });

  for (let i = 0; i < 8; i++) {
    const returned = Promise.withResolvers<void>();
    const churn: Promise<void>[] = [];
    await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(socket) {
          // Closing moves the socket to the loop's closed list; it may only be
          // freed once this callback (and the dispatch that called it) is done.
          socket.terminate();
          // Nested ticks: timers, I/O and the loop's post phase all run here.
          expect(new Promise<void>(resolve => setTimeout(resolve, 5))).resolves.toBeUndefined();
          // Allocations of the same size class as the closed socket, so a
          // prematurely freed block is likely to be handed out again before
          // the outer dispatch looks at it.
          for (let j = 0; j < 16; j++) {
            churn.push(
              Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } }).then(s => s.terminate()),
            );
          }
          returned.resolve();
        },
      },
    });
    await returned.promise;
    await Promise.all(churn);
    // Let the outer dispatch unwind and the loop reach its post phase.
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});

// Two client sockets become readable in the same poll of the loop (the server
// writes to both while this thread is busy). A's data handler then waits, with
// nested event-loop ticks, for B's data handler to have run. B's readiness was
// collected by the outer tick before A's handler started; the nested ticks must
// still deliver it, or A waits for an event the loop already has in hand.
test("an event collected by the outer tick is delivered to a nested tick", async () => {
  const accepted: any[] = [];
  const bothAccepted = Promise.withResolvers<void>();
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        accepted.push(socket);
        if (accepted.length === 2) bothAccepted.resolve();
      },
      data() {},
    },
  });

  const order: string[] = [];
  const gotB = Promise.withResolvers<void>();
  const aDone = Promise.withResolvers<void>();
  const a = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data() {
        order.push("a:start");
        // The deadline turns "never delivered" into a failure of this test
        // rather than a hang of the whole file.
        const deadline = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("b's data was not delivered to the nested tick")), 2000),
        );
        expect(Promise.race([gotB.promise, deadline])).resolves.toBeUndefined();
        order.push("a:end");
        aDone.resolve();
      },
    },
  });
  const b = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data() {
        order.push("b");
        gotB.resolve();
      },
    },
  });
  await bothAccepted.promise;

  accepted[0].write("a");
  accepted[0].flush();
  accepted[1].write("b");
  accepted[1].flush();
  // Stay busy until both writes have certainly arrived, so the next poll of
  // the loop reports both sockets at once.
  Bun.sleepSync(100);

  await aDone.promise;
  // Which of the two is dispatched first is up to the kernel; either way a's
  // wait has to end with b already delivered.
  expect(order.indexOf("b")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("b")).toBeLessThan(order.indexOf("a:end"));
  a.terminate();
  b.terminate();
});

test("an event collected by the outer tick is delivered to a nested tick (child process pipes)", async () => {
  // Same shape as above with pipe reads instead of sockets: both children
  // answer at once, so one poll of the loop collects both stdout reads, and
  // whichever is handled first waits (in a nested tick) for the other.
  const child = `process.stdout.write("r"); process.stdin.on("data", () => { process.stdout.write("x"); });`;
  const spawn = () =>
    Bun.spawn({ cmd: [process.execPath, "-e", child], stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  await using a = spawn();
  await using b = spawn();
  const ra = a.stdout.getReader();
  const rb = b.stdout.getReader();
  // Both children are up once they have said "r".
  expect(new TextDecoder().decode((await ra.read()).value)).toBe("r");
  expect(new TextDecoder().decode((await rb.read()).value)).toBe("r");

  const order: string[] = [];
  const got = { a: Promise.withResolvers<void>(), b: Promise.withResolvers<void>() };
  const handled = (me: "a" | "b", other: "a" | "b") => () => {
    order.push(me + ":start");
    got[me].resolve();
    const deadline = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(other + "'s data was not delivered to the nested tick")), 2000),
    );
    expect(Promise.race([got[other].promise, deadline])).resolves.toBeUndefined();
    order.push(me + ":end");
  };
  const done = Promise.all([ra.read().then(handled("a", "b")), rb.read().then(handled("b", "a"))]);

  a.stdin.write("go");
  a.stdin.flush();
  b.stdin.write("go");
  b.stdin.flush();
  // Stay busy until both children have certainly answered, so the next poll
  // of the loop reports both pipes at once.
  Bun.sleepSync(200);

  await done;
  const [first, second] = order[0] === "a:start" ? ["a", "b"] : ["b", "a"];
  expect(order).toEqual([first + ":start", second + ":start", second + ":end", first + ":end"]);
  a.kill();
  b.kill();
});
