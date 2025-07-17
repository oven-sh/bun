import { fork } from "child_process";

if (process.argv[2] === "child") {
  process.send("a!");
  process.send("b!");
  process.send("c!");
  process.send("d!");
  process.send("hello".repeat(2 ** 15));
  process.send("goodbye".repeat(2 ** 15));
  process.send("hello".repeat(2 ** 15));
  process.send("goodbye".repeat(2 ** 15));
  process.disconnect();
} else {
  const proc = fork(process.argv[1], ["child"], {});

  proc.on("message", message => {
    console.log(message.length + ": " + message[message.length - 2]);
  });

  proc.on("disconnect", () => {
    console.log("disconnected");
  });
}
