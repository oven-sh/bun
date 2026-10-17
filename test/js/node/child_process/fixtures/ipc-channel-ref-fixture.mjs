// Prints whether the event loop is held after a sequence of operations on `subprocess.channel` or `process.channel`.
// Runs unchanged on Node, which skips the Bun.spawn() row. Its only other answer is "held" for `send(small)`.
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

const [role, ops = ""] = process.argv.slice(2);
const self = import.meta.filename;
const held = 10;

async function applyAndReport(table) {
  for (const op of ops.split(" ")) await table[op]();
  // The driver answers each line on stdin. A loop that nothing holds turns a few more times at most (a handle that is
  // closing, say) and the exit code is 0. One that still answers after 10 round trips is held.
  let answers = 0;
  process.stdin
    .on("data", () => {
      if (++answers === 10) process.exit(held);
      console.log("still here");
    })
    .unref();
  console.log("applied");
}
const send = (target, length) => new Promise(sent => target.send(Buffer.alloc(length, "a").toString(), sent));
// Too big for the pipe's buffer, so the write finishes later.
const sendBig = target => send(target, 1_000_000);
const channelOps = channel => ({
  "none": () => {},
  "ref": () => channel.ref(),
  "unref": () => channel.unref(),
  "refCounted": () => channel.refCounted(),
  "unrefCounted": () => channel.unrefCounted(),
});

if (role === "idle") {
  // exit(): a handle it was sent and has no listener for would hold its loop.
  process.on("disconnect", () => process.exit());
} else if (role === "parent") {
  const child = fork(self, ["idle"], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    serialization: ops.startsWith("advanced") ? "advanced" : "json",
  });
  await applyAndReport({
    ...channelOps(child.channel),
    "advanced": () => {},
    "child.unref": () => child.unref(),
    "disconnect": () => child.disconnect(),
    "send(small)": () => send(child, 1),
    "send(big)": () => sendBig(child),
    "send(handle)": async () => {
      const server = createServer().listen(0);
      await once(server, "listening");
      await new Promise(sent => child.send("handle", server, sent));
      await new Promise(closed => server.close(closed));
    },
  });
} else if (role === "Bun.spawn") {
  const child = Bun.spawn({ cmd: [process.execPath, self, "idle"], ipc() {}, stdio: ["ignore", "ignore", "inherit"] });
  await applyAndReport({
    "child.unref": () => child.unref(),
  });
} else if (role === "child") {
  const [a, b] = [() => {}, () => {}];
  await applyAndReport({
    ...channelOps(process.channel),
    "on(message,a)": () => process.on("message", a),
    "on(message,b)": () => process.on("message", b),
    "off(message,a)": () => process.off("message", a),
    "on(disconnect,a)": () => process.on("disconnect", a),
    "removeAll(message)": () => process.removeAllListeners("message"),
    "disconnect": () => process.disconnect(),
    "send(big)": () => sendBig(process),
  });
} else {
  // Both sides share one implementation of the four methods. The child's rows cover it, the parent's that it is wired up.
  const rows = [
    ["parent", "child.unref"],
    ["parent", "child.unref unref"],
    ["parent", "child.unref unref ref"],
    ["parent", "child.unref refCounted unrefCounted"],
    ["parent", "child.unref disconnect"],
    ["parent", "child.unref disconnect ref"],
    ["parent", "child.unref send(small)"],
    ["parent", "child.unref send(big)"],
    ["parent", "child.unref ref send(big)"],
    ["parent", "child.unref send(handle)"],
    ["parent", "advanced child.unref"],
    ...(process.versions.bun ? [["Bun.spawn", "child.unref"]] : []),
    ["child", "none"],
    ["child", "on(message,a)"],
    ["child", "on(disconnect,a)"],
    ["child", "on(message,a) off(message,a)"],
    ["child", "on(message,a) on(message,b) off(message,a)"],
    ["child", "on(message,a) on(message,b) removeAll(message)"],
    ["child", "on(message,a) unrefCounted"],
    ["child", "on(message,a) on(disconnect,a) unrefCounted"],
    ["child", "on(message,a) on(message,b) unrefCounted removeAll(message) on(message,a)"],
    ["child", "refCounted"],
    ["child", "refCounted unrefCounted"],
    ["child", "refCounted refCounted unrefCounted"],
    ["child", "unrefCounted refCounted"],
    ["child", "unrefCounted on(message,a)"],
    ["child", "ref"],
    ["child", "ref unrefCounted"],
    ["child", "ref on(message,a) off(message,a)"],
    ["child", "on(message,a) unref"],
    ["child", "on(message,a) unref refCounted"],
    ["child", "unref on(message,a)"],
    ["child", "send(big)"],
    ["child", "on(message,a) send(big)"],
    ["child", "on(message,a) disconnect"],
    ["child", "disconnect ref"],
  ].filter(([role]) => (role === "child") === (ops === "child"));
  for (let i = 0; i < rows.length; i += 8) {
    const batch = rows.slice(i, i + 8).map(async ([role, ops]) => {
      const child =
        role === "child"
          ? fork(self, [role, ops], { stdio: ["pipe", "pipe", "inherit", "ipc"] })
          : spawn(process.execPath, [self, role, ops], { stdio: ["pipe", "pipe", "inherit"] });
      // EPIPE: it has left already.
      child.stdin.on("error", () => {});
      child.stdout.on("data", () => child.stdin.write("still there?"));
      const [code] = await once(child, "exit");
      return `${role}: ${ops}: ${code === held ? "held" : code === 0 ? "not held" : `exit code ${code}`}`;
    });
    for (const row of batch) console.log(await row);
  }
}
