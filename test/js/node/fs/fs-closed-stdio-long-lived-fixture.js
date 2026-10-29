// Usage: bun fs-closed-stdio-long-lived-fixture.js <dir>
//
// For fd 0, then fd 1, then fd 2: closes that fd and creates descriptors that bun keeps for a while.
// The kernel gives a new descriptor the lowest free number, so each of them gets the closed number
// unless bun moves it. The fixture reports which ones sat on the closed number while they lived.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = process.argv[2];
const file = path.join(dir, "data.txt");
fs.writeFileSync(file, "hello\n");
// Opened before any number is free, so these never take one.
const out = fs.openSync(path.join(dir, "result.json"), "w");
const data = fs.openSync(file, "r");

const noop = () => {};
const listen = socket => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: noop, ...socket } });

// The fd that is closed now. None during the warm-up.
let slot = -1;
const freeSlot = () => {
  if (slot !== -1) fs.closeSync(slot);
};
const slotState = () => {
  if (slot === -1) return "closed";
  try {
    fs.fstatSync(slot);
  } catch (e) {
    return e.code === "EBADF" ? "closed" : e.code;
  }
  try {
    return "open: " + fs.readlinkSync("/proc/self/fd/" + slot).replace(dir, "<dir>");
  } catch {
    return "open";
  }
};

// Each one frees the slot, creates its descriptor, and returns the state of the slot while the descriptor lives.
const creators = {
  "the socket of Bun.listen": async () => {
    freeSlot();
    const server = listen({});
    const state = slotState();
    server.stop(true);
    return state;
  },
  "the socket of Bun.connect": async () => {
    const server = listen({});
    freeSlot();
    const client = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data: noop } });
    const state = slotState();
    client.end();
    server.stop(true);
    return state;
  },
  "a socket that Bun.listen accepts": async () => {
    const { promise: accepted, resolve } = Promise.withResolvers();
    const server = listen({ open: resolve });
    // The socket of the client exists before the slot is free. The next descriptor is the accepted one.
    const connecting = Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data: noop } });
    freeSlot();
    const [client] = await Promise.all([connecting, accepted]);
    const state = slotState();
    client.end();
    server.stop(true);
    return state;
  },
  "the duplicate behind a writer of Bun.file(fd)": async () => {
    freeSlot();
    // The source is a stdio fd that is still open.
    const writer = Bun.file(slot === 2 ? 1 : 2).writer();
    const state = slotState();
    await writer.end();
    return state;
  },
  "the duplicate behind a stream of Bun.file(fd)": async () => {
    freeSlot();
    const reader = Bun.file(data).stream().getReader();
    await reader.read();
    const state = slotState();
    await reader.cancel();
    return state;
  },
};

(async () => {
  // The first use of an API can open a descriptor that it keeps. So every creator runs once before a number is free.
  for (const create of Object.values(creators)) await create();

  const result = {};
  for (slot of [0, 1, 2]) {
    const onTheClosedNumber = (result["fd " + slot] = {});
    for (const [name, create] of Object.entries(creators)) {
      const state = await create();
      if (state !== "closed") onTheClosedNumber[name] = state;
      // Takes the number again, so the next creator, and then the next round, starts with it in use.
      if (slotState() === "closed") fs.openSync(os.devNull, "r");
    }
  }
  fs.writeSync(out, JSON.stringify(result));
  process.exit(0);
})().catch(e => {
  // stderr can be the closed number, so the error goes into the result.
  fs.writeSync(out, "\n" + (e?.stack ?? String(e)));
  process.exit(1);
});
