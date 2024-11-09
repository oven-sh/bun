import { spawn } from "node:child_process";
import { join } from "path";

const child = spawn(join(import.meta.dirname, "./raiser"), [], { stdio: "inherit" });
child.on("close", code => {
  console.log(`exited with ${code}`);
});
