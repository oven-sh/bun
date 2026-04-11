// Under a real TTY (highWaterMark 0), after removing the last 'readable'
// listener Node releases fd 0 via backpressure (push() returns false →
// readStop()) once the next chunk arrives, so a stdio:'inherit' child reads
// subsequent bytes. Parent may buffer at most ONE chunk before release.
import { spawn } from "node:child_process";

const drain = () => {
  let c;
  while ((c = process.stdin.read()) !== null) {
    process.stdout.write("PARENT:" + JSON.stringify(c.toString()) + "\n");
  }
};
process.stdin.setRawMode(true);
process.stdin.on("readable", drain);

// give the read loop a tick to start
process.stdout.write("%ready%\n");

process.stdin.once("readable", () => {
  // first byte arrives → drain it, then unsubscribe and hand off to child
  process.stdin.removeListener("readable", drain);
  process.stdin.setRawMode(false);

  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.stdin.setRawMode(true);
       process.stdin.on("data", d => {
         for (const ch of d.toString()) {
           if (ch === "\\x03") process.exit(0);
           process.stdout.write("CHILD:" + JSON.stringify(ch) + "\\n");
         }
         process.stdout.write("%ready%\\n");
       });
       process.stdout.write("%ready%\\n");`,
    ],
    { stdio: "inherit" },
  );
  child.on("close", code => {
    process.stdout.write("PARENT: child closed " + code + "\n");
    process.stdout.write("%ready%\n");
    process.exit(code ?? 1);
  });
});
