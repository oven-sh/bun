// A producer that exits before the consumer sharing its stdout has read
// anything: the parent must leave the pipe's bytes for the consumer (node marks
// the stream kIsUsedAsStdio and skips it in flushStdio).
const { spawn } = require("node:child_process");

if (process.argv[2] === "consumer") {
  process.once("message", () => {
    let read = 0;
    process.stdin.on("data", chunk => (read += chunk.length));
    process.stdin.on("end", () => {
      console.log(JSON.stringify({ consumerRead: read }));
      process.disconnect();
    });
  });
} else {
  const producer = spawn(process.execPath, ["-e", 'require("fs").writeSync(1, Buffer.alloc(4096, "x"))'], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const consumer = spawn(process.execPath, [__filename, "consumer"], {
    stdio: [producer.stdout, "inherit", "inherit", "ipc"],
  });
  producer.on("exit", () => consumer.send("producer exited"));
}
