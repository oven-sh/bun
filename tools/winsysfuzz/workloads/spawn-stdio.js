// scenario: child processes + stdio pipes — NtCreateUserProcess / NtCreateNamedPipeFile
const cp = require("child_process");

console.log("STAGE: spawn-pipe");
const p = Bun.spawn(["cmd.exe", "/c", "echo one"], { stdout: "pipe" });
const one = (await new Response(p.stdout).text()).trim();
await p.exited;

console.log("STAGE: stdin-roundtrip");
const q = Bun.spawn(["findstr", "x"], { stdin: "pipe", stdout: "pipe" });
q.stdin.write("axb\nnope\n");
await q.stdin.end();
const echoed = (await new Response(q.stdout).text()).trim();
await q.exited;

console.log("STAGE: spawnsync-exec");
const sy = cp.spawnSync("cmd.exe", ["/c", "echo sync"], { encoding: "utf8" });
const ex = await new Promise(res => cp.exec("cmd.exe /c echo execd", (e, so) => res(so.trim())));

console.log("STAGE: done"); console.log(`spawn ok one=${one} echoed=${echoed} sync=${sy.stdout.trim()} exec=${ex}`);
