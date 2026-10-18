// Runs unchanged on Node. Each row prints what a 'message' listener received that was added after the messages arrived.
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

const throws = "a listener that throws";
const channelMethods = ["ref", "unref", "refCounted", "unrefCounted"];
const openedBy = variant => channelMethods.find(method => variant === `opened by channel.${method}()`);
const throwsBeforeAnother = "a listener that throws, added before another";
const throwsThenOtherEvent = "a listener that throws, then a listener for another event";
const throwsFromTheStart = "listeners from the start, the first throws";
const variants = [
  "a late listener",
  "a handle",
  throws,
  throwsBeforeAnother,
  throwsThenOtherEvent,
  "once",
  "added and removed in one tick",
  "disconnect() in the tick that adds it",
  "removeAllListeners('newListener')",
  "emit() replaced",
  throwsFromTheStart,
  ...channelMethods.map(method => `opened by channel.${method}()`),
];
process.on("uncaughtException", error => {
  if (error.message !== throws) throw error;
});

function send(peer, variant, written) {
  const start = async () => {
    if (variant === "a handle") {
      const server = createServer().listen(0);
      await once(server, "listening");
      peer.send("first", server, () => server.close());
    } else {
      peer.send("first");
    }
    peer.send({ cmd: "NODE_never a 'message'" });
    peer.send("second", written);
  };
  peer.on("message", message => (message === "ready" ? start() : peer.send("end")));
  if (openedBy(variant)) start();
}

function receive(target, variant, whenWritten) {
  const got = [];
  const listen = () => {
    target.on("message", (message, handle) => {
      got.push(handle ? [message, handle.constructor.name] : message);
      handle?.close();
      if (message === "end") target.disconnect();
    });
  };
  const listenAndAskForTheEnd = () => {
    listen();
    target.send("more");
  };
  const throwAtFirst = message => {
    if (message === "first") throw new Error(throws);
  };
  if (variant === throwsFromTheStart) {
    target.on("message", throwAtFirst);
    listen();
  }
  // In a child this is also what opens the channel, so that it is read with no 'message' listener.
  if (openedBy(variant)) {
    target.channel[openedBy(variant)]();
    // After unref() or unrefCounted() the channel does not hold the loop until "end" arrives.
    setInterval(() => {}, 2 ** 30);
  } else {
    target.send("ready");
  }
  // Two turns of the loop after the sender's callback ran, the channel has been read.
  whenWritten(() =>
    setImmediate(setImmediate, () => {
      if (variant === throws) {
        listenAndAskForTheEnd();
        target.on("message", throwAtFirst);
      } else if (variant === throwsBeforeAnother) {
        target.on("message", throwAtFirst);
        listenAndAskForTheEnd();
      } else if (variant === throwsThenOtherEvent) {
        listen();
        target.on("message", throwAtFirst);
        setImmediate(() => {
          target.on("another event", () => {});
          setImmediate(() => target.send("more"));
        });
      } else if (variant === throwsFromTheStart) {
        target.send("more");
      } else if (variant === "emit() replaced") {
        const { emit } = target;
        target.emit = function (name, message) {
          if (name === "message") got.push(`emit(${message})`);
          return emit.apply(this, arguments);
        };
        listenAndAskForTheEnd();
      } else if (variant === "once") {
        target.once("message", message => got.push(message));
        setImmediate(listenAndAskForTheEnd);
      } else if (variant === "added and removed in one tick") {
        target.on("message", listen).off("message", listen);
        setImmediate(listenAndAskForTheEnd);
      } else if (variant === "disconnect() in the tick that adds it") {
        listen();
        target.disconnect();
      } else {
        if (variant === "removeAllListeners('newListener')") target.removeAllListeners("newListener");
        listenAndAskForTheEnd();
      }
    }),
  );
  return got;
}

const [variant, role] = process.argv.slice(2);
if (role === "receiver") {
  const got = receive(process, variant, fn => process.stdin.once("data", fn));
  process.on("exit", () => console.log(JSON.stringify(got)));
  // A handle that was dropped with its message would hold the loop.
  process.on("disconnect", () => process.exit());
} else if (role === "sender") {
  send(process, variant, () => console.log("written"));
} else {
  for (const role of ["receiver", "sender"]) {
    const rows = variants.map(async variant => {
      const child = fork(import.meta.filename, [variant, role], { stdio: ["pipe", "pipe", "inherit", "ipc"] });
      let out = "";
      child.stdout.setEncoding("utf8").on("data", data => (out += data));
      let got;
      if (role === "receiver") send(child, variant, () => child.stdin.end("written"));
      else got = receive(child, variant, fn => child.stdout.once("data", fn));
      // Not "close": Node does not emit it once the parent has called disconnect().
      await Promise.all([once(child, "exit"), once(child.stdout, "end")]);
      return `${role === "receiver" ? "child" : "parent"}, ${variant}: ${got ? JSON.stringify(got) : out.trim()}`;
    });
    for (const row of rows) console.log(await row);
  }
  process.exit();
}
