// Bun.spawnSync, Bun.spawn with pipes both ways, resourceUsage, kill, node:child_process
import { execFileSync, spawn } from "node:child_process";
const sync = Bun.spawnSync(["sh", "-c", "echo out; echo err >&2; exit 3"]);
console.log(
  sync.exitCode,
  sync.success,
  JSON.stringify(sync.stdout.toString()),
  JSON.stringify(sync.stderr.toString()),
);
const child = Bun.spawn(["tr", "a-z", "A-Z"], { stdin: "pipe", stdout: "pipe", env: { PATH: process.env.PATH! } });
child.stdin.write("hello ");
child.stdin.write("child");
await child.stdin.end();
console.log(
  await new Response(child.stdout).text(),
  await child.exited,
  child.killed,
  typeof child.pid,
  typeof child.resourceUsage()?.maxRSS,
);
const sleeper = Bun.spawn(["sleep", "30"], {
  onExit(_process: any, code: number | null, signal: any) {
    console.log("onExit", code, signal);
  },
});
sleeper.kill("SIGTERM");
console.log(await sleeper.exited, sleeper.signalCode);
console.log(JSON.stringify(execFileSync("printf", ["%s-%s", "a", "b"]).toString()));
const { promise, resolve } = Promise.withResolvers<number | null>();
const node = spawn("sh", ["-c", "cat; exit 2"], { stdio: ["pipe", "pipe", "inherit"] });
let text = "";
node.stdout.on("data", (chunk: any) => (text += chunk));
node.on("close", (code: number | null) => resolve(code));
node.stdin.end("through node");
console.log(await promise, text);
