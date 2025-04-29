import { fork } from "child_process";

if (process.argv[2] === "child") {
  process.send("hello".repeat(2 ** 20));
  process.disconnect();
} else {
  const proc = fork(process.argv[1], ["child"], {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  proc.on("message", message => {
    console.log(message.length);
  });
}
