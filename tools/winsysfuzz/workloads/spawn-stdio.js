// scenario: child processes + stdio pipes — NtCreateUserProcess / NtCreateNamedPipeFile
const cp = require("child_process");

// 1. Bun.spawn with piped stdout
const p = Bun.spawn(["cmd.exe", "/c", "echo one"], { stdout: "pipe" });
const one = (await new Response(p.stdout).text()).trim();
await p.exited;

// 2. stdin -> child -> stdout round-trip (findstr echoes matching lines)
const q = Bun.spawn(["findstr", "x"], { stdin: "pipe", stdout: "pipe" });
q.stdin.write("axb\nnope\n");
await q.stdin.end();
const echoed = (await new Response(q.stdout).text()).trim();
await q.exited;

// 3. spawnSync + exec
const sy = cp.spawnSync("cmd.exe", ["/c", "echo sync"], { encoding: "utf8" });
const ex = await new Promise(res => cp.exec("cmd.exe /c echo execd", (e, so) => res(so.trim())));

console.log(`spawn ok one=${one} echoed=${echoed} sync=${sy.stdout.trim()} exec=${ex}`);
