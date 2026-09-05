// A child's stdout stream as another child's stdin: the consumer reads the
// pipe's descriptor directly, and the parent reads the rest once the consumer
// has exited (node's test-child-process-stdio-reuse-readable-stdio).
const { spawn } = require("node:child_process");

const producer = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const consumer = spawn(
  process.execPath,
  ["-e", 'process.stdin.once("data", d => { process.stdout.write(d); process.exit(0); })'],
  { stdio: [producer.stdout, "pipe", "inherit"] },
);

const result = {
  pausedWhileShared: producer.stdout.readableFlowing === false,
  consumerGot: "",
  parentGot: "",
};
consumer.stdout.setEncoding("utf8");
consumer.stdout.on("data", chunk => (result.consumerGot += chunk));
producer.stdin.write("hello\n");

consumer.on("exit", () => {
  producer.stdin.end("world\n");
  producer.stdout.setEncoding("utf8");
  producer.stdout.on("data", chunk => (result.parentGot += chunk));
  producer.stdout.on("end", () => console.log(JSON.stringify(result)));
});
