// Prints which of `subprocess.channel` / `process.channel`'s ref states hold the event loop.
// Runs unchanged under node: every process is `process.execPath`.
import { fork, spawn } from "node:child_process";
import { once } from "node:events";

const [role, ops = ""] = process.argv.slice(2);
const self = import.meta.filename;
const apply = table => {
  for (const op of ops.split(" ")) table[op]();
};

if (role === "parent") {
  // A loop nothing holds ends without polling, so the message is seen only if something held it.
  const child = fork(self, ["pinger"]);
  child.on("message", () => {
    console.log("message");
    child.disconnect();
  });
  const channel = child.channel;
  apply({
    "none": () => {},
    "child.unref": () => child.unref(),
    "disconnect": () => child.disconnect(),
    "ref": () => channel.ref(),
    "unref": () => channel.unref(),
    "refCounted": () => channel.refCounted(),
    "unrefCounted": () => channel.unrefCounted(),
  });
} else if (role === "pinger") {
  process.on("disconnect", () => process.exit());
  process.send("ping", () => {});
} else if (role === "child") {
  const [a, b] = [() => {}, () => {}];
  const channel = process.channel;
  // The driver disconnects only after "ready", and seeing that takes a poll.
  process.on("beforeExit", () => console.log(process.connected ? "exits" : "stays"));
  apply({
    "none": () => {},
    "on(message,a)": () => process.on("message", a),
    "on(message,b)": () => process.on("message", b),
    "once(message,a)": () => process.once("message", a),
    "off(message,a)": () => process.off("message", a),
    "on(disconnect,a)": () => process.on("disconnect", a),
    "removeAll(message)": () => process.removeAllListeners("message"),
    "ref": () => channel.ref(),
    "unref": () => channel.unref(),
    "refCounted": () => channel.refCounted(),
    "unrefCounted": () => channel.unrefCounted(),
  });
  console.log("ready");
} else {
  const output = async (child, onData) => {
    let out = "";
    child.stdout.setEncoding("utf8").on("data", data => {
      out += data;
      onData?.(out);
    });
    // Not "close": node does not emit it once the parent has called disconnect().
    const [[code]] = await Promise.all([once(child, "exit"), once(child.stdout, "end")]);
    return code === 0 ? out : `exit code ${code}`;
  };
  const parentRows = [
    "none",
    "child.unref",
    "unref",
    "child.unref unref",
    "child.unref unref ref",
    "child.unref disconnect",
    "child.unref unrefCounted",
    "child.unref refCounted unrefCounted",
    "child.unref refCounted refCounted unrefCounted",
    "child.unref unref refCounted",
    "child.unref ref refCounted unrefCounted",
  ].map(async ops => {
    const out = await output(spawn(process.execPath, [self, "parent", ops], { stdio: ["ignore", "pipe", "inherit"] }));
    return `parent: ${ops.padEnd(48)} ${out === "message\n" ? "stays" : out === "" ? "exits" : out}`;
  });
  const childRows = [
    "none",
    "on(message,a)",
    "once(message,a)",
    "on(disconnect,a)",
    "on(message,a) off(message,a)",
    "on(message,a) on(message,b) off(message,a)",
    "on(message,a) on(message,b) removeAll(message)",
    "on(message,a) unrefCounted",
    "on(message,a) on(disconnect,a) unrefCounted",
    "on(message,a) on(disconnect,a) unrefCounted unrefCounted",
    "on(message,a) on(message,b) unrefCounted removeAll(message) on(message,a)",
    "refCounted",
    "refCounted unrefCounted",
    "unrefCounted refCounted",
    "unrefCounted on(message,a)",
    "ref",
    "ref unrefCounted",
    "ref on(message,a) off(message,a)",
    "on(message,a) unref",
    "on(message,a) unref refCounted",
    "unref on(message,a)",
  ].map(async ops => {
    const child = fork(self, ["child", ops], { stdio: ["ignore", "pipe", "inherit", "ipc"] });
    const out = await output(child, sofar => {
      if (sofar.includes("ready\n") && child.connected) child.disconnect();
    });
    return `child:  ${ops.padEnd(74)} ${out.replace("ready\n", "").trim()}`;
  });
  for (const row of [...parentRows, ...childRows]) console.log(await row);
}
