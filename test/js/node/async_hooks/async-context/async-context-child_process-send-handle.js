process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { fork } = require("child_process");
const net = require("net");

// On Windows Bun can lose the ACK of a handle (#37815), and this file would then wait for it.
if (process.platform === "win32") process.exit(0);

const asyncLocalStorage = new AsyncLocalStorage();
const store = () => asyncLocalStorage.getStore()?.test ?? "(no store)";
// Calls a function in no async context at all, wherever the caller runs.
const outsideAnyContext = AsyncLocalStorage.snapshot();

// More than the channel's buffer holds: send() returns before the write is complete, unless the
// peer reads the rest in the meantime.
const big = Buffer.alloc(1 << 20, "x").toString();

// The callback of a send() with a handle runs in the store of that send() call. A message sent
// before the ACK of a handle arrives is different: Node holds it and sends it from its ACK handler,
// so its callback runs where the events of the channel run. That is no store in this file.
// Calls done() with the callbacks that ran somewhere else.
function sendRows(target, name, done) {
  const failures = [];
  const server = net.createServer();
  // Makes the sends of `rows`, then calls next() once each of their callbacks has run.
  const group = (rows, next) => {
    let pending = 0;
    const callback = expected => error => {
      if (error) failures.push(`FAIL: ${name} in "${expected}" failed: ${error}`);
      if (store() !== expected) failures.push(`FAIL: ${name} callback ran in "${store()}", expected "${expected}"`);
      if (--pending === 0) outsideAnyContext(next);
    };
    const send = (test, expected, message) => {
      pending++;
      asyncLocalStorage.run({ test }, () => target.send(...message, callback(expected)));
    };
    rows({
      own: (row, ...message) => send(`${name} ${row}`, `${name} ${row}`, message),
      held: (...message) => send(`${name} held`, "(no store)", message),
      heldWithNoStore: (...message) => (pending++, target.send(...message, callback("(no store)"))),
    });
  };
  server.listen(0, () => {
    group(
      ({ own, held }) => {
        // The handle waits behind a write, so the message after it is held before the handle is written.
        own("big", { big });
        own("handle behind big", { handle: true }, server);
        held({ held: true });
      },
      () =>
        group(
          ({ own, held }) => {
            // The channel takes the handle at once, and nothing but its ACK is awaited.
            own("handle", { handle: true }, server);
            held({ held: true });
          },
          () =>
            group(
              ({ own, held, heldWithNoStore }) => {
                own("handle again", { handle: true }, server);
                // Held with no callback: the next send adds the first callback to a queued message.
                target.send({ held: true });
                held({ held: true });
                held({ big });
                heldWithNoStore({ held: true });
                held({ handle: true }, server);
              },
              () => {
                server.close();
                done(failures);
              },
            ),
        ),
    );
  });
}

if (process.argv[2] === "child") {
  process.exitCode = 0;
  process.on("message", (message, handle) => {
    if (handle) handle.close();
    if (message.start) sendRows(process, "process.send", failures => process.send({ failures }));
  });
} else {
  const failures = [];
  const child = fork(__filename, ["child"]);
  child.on("exit", code => {
    if (code !== 0) failures.push(`FAIL: child exited with code ${code}`);
    for (const failure of failures) console.error(failure);
    process.exit(failures.length ? 1 : 0);
  });
  child.on("message", (message, handle) => {
    if (handle) handle.close();
    if (!message.failures) return;
    failures.push(...message.failures);
    child.disconnect();
  });
  sendRows(child, "child.send", parentFailures => {
    failures.push(...parentFailures);
    child.send({ start: true });
  });
}
