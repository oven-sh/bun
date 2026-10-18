// Runs unchanged on Node. Each row prints what a 'message' listener received that was added after the messages arrived.
import { fork } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";

const throws = "a listener that throws";
const throwsBeforeAnother = "a listener that throws, added before another";
const throwsThenOtherEvent = "a listener that throws, then a listener for another event";
const returns1AsTheyArrive = "nobody listens and listenerCount() returns 1 as they arrive";
const returns1InTheTick = "nobody listens and listenerCount() returns 1 in the tick";
const countThrows = "nobody listens and listenerCount() throws";
const countIs5 = "nobody listens and listenerCount is 5";
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
  returns1AsTheyArrive,
  returns1InTheTick,
  "the listenerCount() of node:events",
  countThrows,
  countIs5,
];
// The parent's rows share one process.
const gotOf = new Map();
process.on("uncaughtException", error => {
  if (error.message === throws) return;
  const got = gotOf.get(error.message === countThrows ? countThrows : countIs5);
  if (!got) throw error;
  got.push(error.name);
});

function send(peer, variant) {
  peer.on("message", async message => {
    if (message !== "ready") return peer.send("end");
    if (variant === "a handle") {
      const server = createServer().listen(0);
      await once(server, "listening");
      peer.send("first", server, () => server.close());
    } else {
      peer.send("first");
    }
    peer.send({ cmd: "NODE_never a 'message'" });
    peer.send("second");
    peer.send({ cmd: "NODE_that was all" });
  });
}

function receive(target, variant) {
  const got = [];
  gotOf.set(variant, got);
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
  target.on("internalMessage", ({ cmd }) => {
    if (cmd !== "NODE_that was all") return;
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
    } else if (variant === "once") {
      target.once("message", message => got.push(message));
      setImmediate(listenAndAskForTheEnd);
    } else if (variant === "added and removed in one tick") {
      target.on("message", listen).off("message", listen);
      setImmediate(listenAndAskForTheEnd);
    } else if (variant === "disconnect() in the tick that adds it") {
      listen();
      target.disconnect();
    } else if (variant === returns1InTheTick) {
      target.listenerCount = () => 1;
      target.on("another event", () => {});
      setImmediate(() => {
        delete target.listenerCount;
        listenAndAskForTheEnd();
      });
    } else {
      delete target.listenerCount;
      if (variant === "a late listener") globalThis.Bun?.gc(true);
      if (variant === "the listenerCount() of node:events") target.listenerCount = EventEmitter.prototype.listenerCount;
      if (variant === "removeAllListeners('newListener')") target.removeAllListeners("newListener");
      listenAndAskForTheEnd();
    }
  });
  // After the ticks of the listeners that were added so far.
  setImmediate(() => {
    if (variant === returns1AsTheyArrive) target.listenerCount = () => 1;
    if (variant === countIs5) target.listenerCount = 5;
    if (variant === countThrows) {
      target.listenerCount = () => {
        throw new RangeError(countThrows);
      };
    }
    // In a child this is also what opens the channel, so that it is read with no 'message' listener.
    target.send("ready");
  });
  return got;
}

const [variant, role] = process.argv.slice(2);
if (role === "receiver") {
  const got = receive(process, variant);
  process.on("exit", () => console.log(JSON.stringify(got)));
  // A handle that was dropped with its message would hold the loop.
  process.on("disconnect", () => process.exit());
} else if (role === "sender") {
  send(process, variant);
} else {
  for (const role of ["receiver", "sender"]) {
    const rows = variants.map(async variant => {
      const child = fork(import.meta.filename, [variant, role], { stdio: ["ignore", "pipe", "inherit", "ipc"] });
      let out = "";
      child.stdout.setEncoding("utf8").on("data", data => (out += data));
      let got;
      if (role === "receiver") send(child, variant);
      else got = receive(child, variant);
      // Not "close": Node does not emit it once the parent has called disconnect().
      await Promise.all([once(child, "exit"), once(child.stdout, "end")]);
      return `${role === "receiver" ? "child" : "parent"}, ${variant}: ${got ? JSON.stringify(got) : out.trim()}`;
    });
    for (const row of rows) console.log(await row);
  }
  process.exit();
}
