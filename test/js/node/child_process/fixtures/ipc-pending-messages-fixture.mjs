// Runs unchanged on Node. Each row prints what a late 'message' listener received.
import { fork } from "node:child_process";
import { once } from "node:events";

const [row, role] = process.argv.slice(2);
// The channel has been read by then: the sender's callback ran before this was called.
const afterTheChannelWasRead = fn => setImmediate(() => setImmediate(fn));
const lines = (stream, onLine) =>
  stream.setEncoding("utf8").on("data", data => data.trim().split("\n").forEach(onLine));
const throws = "a listener that throws";
process.on("uncaughtException", error => {
  if (error.message !== throws) throw error;
});
const collect = (emitter, name, done) => {
  const got = [];
  emitter.on("message", message => {
    got.push(message);
    if (message === "end") done(got);
  });
  if (name.endsWith(throws)) {
    emitter.on("message", message => {
      if (message === "first") throw new Error(throws);
    });
  }
};

// What makes the child read its channel before it has a 'message' listener.
const childRows = {
  "process.send()": () => process.send("from the child"),
  "process.on('disconnect')": () => process.on("disconnect", () => {}),
  "a listener that was removed": () => process.on("message", process.exit).off("message", process.exit),
  "process.once('message') that fired": () => process.once("message", () => {}),
  [throws]: () => process.on("disconnect", () => {}),
};

if (role === "child" && (row === "parent" || row === `parent, ${throws}`)) {
  process.on("message", () => process.send("end", () => process.disconnect()));
  process.send("first");
  process.send("second", () => console.log("sent"));
} else if (role === "child" && row === "parent, after 'disconnect'") {
  process.send("early", () => process.disconnect());
} else if (role === "child" && row === "after 'disconnect'") {
  const got = [];
  process.on("disconnect", () => process.on("message", message => got.push(message)));
  process.on("exit", () => console.log(JSON.stringify(got)));
  console.log("ready");
} else if (role === "child") {
  childRows[row]();
  lines(process.stdin, () =>
    afterTheChannelWasRead(() => {
      collect(process, row, got => {
        console.log(JSON.stringify(got));
        process.exit();
      });
      console.log("listening");
    }),
  );
  console.log("ready");
} else {
  const start = name => fork(import.meta.filename, [name, "child"], { stdio: ["pipe", "pipe", "inherit", "ipc"] });
  const results = [
    ...Object.keys(childRows).map(async name => {
      const child = start(name);
      let result;
      lines(child.stdout, line => {
        if (line === "ready") {
          child.send("first");
          child.send("second", () => child.stdin.write("go\n"));
        } else if (line === "listening") child.send("end");
        else result = line;
      });
      await once(child, "exit");
      return `child, ${name}: ${result}`;
    }),
    (async () => {
      const child = start("after 'disconnect'");
      let result;
      lines(child.stdout, line => {
        if (line === "ready") child.send("first", () => child.disconnect());
        else result = line;
      });
      await once(child, "exit");
      return `child, after 'disconnect': ${result}`;
    })(),
    ...["parent", `parent, ${throws}`].map(async name => {
      const child = start(name);
      const { promise, resolve } = Promise.withResolvers();
      lines(child.stdout, () =>
        afterTheChannelWasRead(() => {
          collect(child, name, resolve);
          child.send("more");
        }),
      );
      return `${name}: ${JSON.stringify(await promise)}`;
    }),
    (async () => {
      const child = start("parent, after 'disconnect'");
      const got = [];
      child.on("disconnect", () => child.on("message", message => got.push(message)));
      await once(child, "close");
      return `parent, after 'disconnect': ${JSON.stringify(got)}`;
    })(),
  ];
  for (const result of results) console.log(await result);
}
