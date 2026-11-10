// Two processes read one UDP socket. 32 datagrams are queued on it while neither reads. Then one
// reader, the closer, stops inside its first 'message' listener, and the other, the counter,
// reads what is left, up to the "end" datagram. Prints what each of them got.
//
// argv[2] says how both come to hold the socket and how the closer stops. Every variant but
// "fd-udpSocket" runs in Node too, which prints { closer: ["0"], counter: ["1" .. "31"] }.
import { fork } from "node:child_process";
import dgram from "node:dgram";
import { readSync } from "node:fs";

const variants = [
  "send-sender-closes", // child.send(message, socket), then the sender closes
  "send-receiver-closes", // child.send(message, socket) to two children, one of them closes
  "send-receiver-exits", // the same, but it calls process.exit()
  "send-then-close", // child.send(message, socket) and socket.close() in one 'message' listener
  "fd", // two children inherit the descriptor as fd 4: socket.bind({ fd: 4 })
  "fd-udpSocket", // the same with Bun.udpSocket({ fd: 4 })
];
const [variant, role] = process.argv.slice(2);
if (!variants.includes(variant)) throw new Error(`unknown variant ${variant}`);
const overIpc = variant.startsWith("send");
const parentCloses = variant === "send-sender-closes" || variant === "send-then-close";
const BURST = 32;

if (role) {
  // A reader in a child process.
  const got = [];
  let close;
  const onDatagram = text => {
    if (role === "counter" && text !== "end") return void got.push(text);
    if (role === "closer") got.push(text);
    if (role === "closer" && variant === "send-receiver-exits") {
      process.send(got);
      process.exit();
    }
    close();
    process.send(got, () => process.exit());
  };
  // The parent is gone: nothing will ever send "end".
  process.on("disconnect", () => process.exit(1));
  // Blocks this process, so that it reads nothing, until the parent writes to its stdin.
  const waitForParent = () => {
    const byte = Buffer.alloc(1);
    for (;;) {
      try {
        return void readSync(0, byte, 0, 1, null);
      } catch (error) {
        if (error.code !== "EAGAIN") throw error;
      }
    }
  };
  const reading = closeSocket => {
    close = closeSocket;
    process.send("ready", waitForParent);
  };

  if (overIpc) {
    process.once("message", (_, socket) => {
      socket.on("message", data => onDatagram(String(data)));
      reading(() => socket.close());
    });
  } else if (variant === "fd") {
    const socket = dgram.createSocket("udp4");
    socket.on("message", data => onDatagram(String(data)));
    socket.bind({ fd: 4 }, () => reading(() => socket.close()));
  } else {
    const socket = await Bun.udpSocket({ fd: 4, socket: { data: (_, data) => onDatagram(String(data)) } });
    reading(() => socket.close());
  }
} else {
  const socket = dgram.createSocket("udp4");
  await new Promise(resolve => socket.bind(0, "127.0.0.1", resolve));
  const sender = dgram.createSocket("udp4");
  await new Promise(resolve => sender.connect(socket.address().port, "127.0.0.1", resolve));
  const burst = () => {
    for (let i = 0; i < BURST; i++) sender.send(String(i));
  };

  // node:dgram has no public name for the descriptor of a socket.
  const state = Object.getOwnPropertySymbols(socket).find(symbol => symbol.description === "state symbol");
  const stdio = ["pipe", "inherit", "inherit", "ipc", ...(overIpc ? [] : [socket[state].handle.fd])];
  const reader = role => {
    const child = fork(import.meta.filename, [variant, role], { stdio });
    const ready = Promise.withResolvers();
    const report = Promise.withResolvers();
    child.on("message", message => (message === "ready" ? ready : report).resolve(message));
    return { child, ready: ready.promise, report: report.promise, release: () => child.stdin.write("go") };
  };

  const counter = reader("counter");
  let got;
  if (parentCloses) {
    socket.on("message", data => {
      got = [String(data)];
      if (variant === "send-then-close") counter.child.send("socket", socket);
      socket.close();
      sender.send("end");
      counter.release();
    });
    if (variant === "send-sender-closes") {
      counter.child.send("socket", socket);
      await counter.ready;
    }
    burst();
  } else {
    const closer = reader("closer");
    if (overIpc) for (const { child } of [closer, counter]) child.send("socket", socket);
    await Promise.all([closer.ready, counter.ready]);
    socket.close();
    burst();
    closer.release();
    got = await closer.report;
    sender.send("end");
    counter.release();
  }
  const left = await counter.report;
  sender.close();
  console.log(JSON.stringify({ closer: got, counter: left }));
}
