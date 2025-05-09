import { fork } from "child_process";
import { connect, createServer } from "net";

if (process.argv[2] === "child") {
  // child
  console.log("[child] starting");
  process.send({ what: "ready" });
  const [message, handle] = await new Promise(r => process.once("message", (message, handle) => r([message, handle])));
  console.log("[child] <-", JSON.stringify(message), handle != null);
  handle.on("connection", socket => {
    console.log("\x1b[95m[client] got connection\x1b[m");
    socket.destroy();
  });
  process.send({ what: "listening" });
  const message2 = await new Promise(r => process.once("message", r));
  console.log("[child] <-", JSON.stringify(message2));
  handle.close();
} else if (process.argv[2] === "minimal") {
  const server = createServer();
  server.on("connection", socket => {
    console.log("\x1b[92m[parent] got connection\x1b[m");
    socket.destroy();
  });
  await new Promise(r => {
    server.on("listening", r);
    server.listen(0);
  });
  console.log("[parent] server listening on port", server.address().port > 0);

  console.log("[connection] create");
  let socket;
  await new Promise(r => (socket = connect(server.address().port, r)));
  console.log("[connection] connected");
  await new Promise(r => socket.on("close", r));
  console.log("[connection] closed");

  server.close();
} else {
  console.log("[parent] starting");
  const child = fork(process.argv[1], ["child"]);
  console.log("[parent] <- ", JSON.stringify(await new Promise(r => child.once("message", r))));

  const server = createServer();
  server.on("connection", socket => {
    console.log("\x1b[92m[parent] got connection\x1b[m");
    socket.destroy();
  });
  await new Promise(r => {
    server.on("listening", r);
    server.listen(0);
  });
  console.log("[parent] server listening on port", server.address().port > 0);

  for (let i = 0; i < 4; i++) {
    console.log("[connection] create");
    let socket;
    await new Promise(r => (socket = connect(server.address().port, r)));
    console.log("[connection] connected");
    await new Promise(r => socket.on("close", r));
    console.log("[connection] closed");
  }

  const result = await new Promise(r => child.send({ what: "server" }, server, r));
  if (result != null) throw result;
  console.log("[parent] sent server to child");
  console.log("[parent] <- ", JSON.stringify(await new Promise(r => child.once("message", r))));

  // once sent to the child, messages can be handled by either the parent or the child
  for (let i = 0; i < 128; i++) {
    // console.log("[connection] create");
    let socket;
    await new Promise(
      r =>
        (socket = connect(
          {
            port: server.address().port,
            host: "127.0.0.1",
          },
          r,
        )),
    );
    // console.log("[connection] connected");
    await new Promise(r => socket.on("close", r));
    // console.log("[connection] closed");
  }

  server.close();
  child.send({ what: "close" });
}
