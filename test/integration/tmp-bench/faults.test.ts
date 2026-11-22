// Temporary: what happens when the system says no. Removed before the PR is ready.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

const prelude = `
  const { fail, failIfFifth, failInPlace, failTimes, noWait: refuseWaits } = require(${JSON.stringify(join(import.meta.dir, "faults.js"))});
  const fs = require("fs"), os = require("os"), { once } = require("events");
  const NO_RESOURCES = 0xc000009a, forever = [process.execPath, "-e", "setInterval(() => {}, 1000)"], quick = [process.execPath, "-e", "0"];
  const shown = error => error?.code ?? error?.message ?? String(error);
  const attempt = f => { try { return f(); } catch (error) { return "threw " + shown(error); } };
  const settle = p => Promise.resolve(p).then(value => value, error => "rejected " + shown(error));
  const during = (undo, f) => { try { return attempt(f); } finally { undo(); } };
  const isAlive = pid => { try { return process.kill(pid, 0); } catch { return false; } };
  const gone = async pid => { for (let i = 0; i < 300 && isAlive(pid); i++) await Bun.sleep(10); return !isAlive(pid); };
  const noWait = how => refuseWaits(NO_RESOURCES, how);
  const say = value => fs.writeFileSync("result.json", JSON.stringify(value));
`;
async function run(script: string, keys?: string) {
  using dir = tempDir("faults", {
    "main.js": `${prelude}\n(async () => { ${script} })();`,
    "file": "abc",
    "folder/x": "",
  });
  let screen = "";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    timeout: 8000,
    ...(keys === undefined
      ? { stdio: ["ignore", "inherit", "inherit"] }
      : { terminal: { data: (_, chunk) => void (screen += Buffer.from(chunk)) } }),
  });
  if (keys) {
    while (!screen.includes("ready") && proc.exitCode === null && !proc.signalCode) await Bun.sleep(5);
    try {
      proc.terminal!.write(keys);
    } catch {}
  }
  const exitCode = await proc.exited;
  proc.terminal?.close();
  const result = await Bun.file(join(String(dir), "result.json"))
    .json()
    .catch(() => "nothing: " + Bun.stripANSI(screen).slice(-300));
  return { result, exitCode };
}

describe.concurrent.skipIf(!isWindows)("refused", () => {
  test.each([
    [
      "report",
      `say(during(fail("NtQuerySystemInformation", 0xc0000001), () => process.report.getReport().header.cpus));`,
    ],
    [
      "no standard handle",
      `const k = require("bun:ffi").dlopen("kernel32.dll", { GetStdHandle: { args: ["i32"], returns: "i64" }, CloseHandle: { args: ["i64"], returns: "i32" } }).symbols; await Bun.spawn(quick).exited; k.CloseHandle(k.GetStdHandle(-10)); say(await Bun.spawn(quick, { stdio: ["inherit", "ignore", "ignore"] }).exited);`,
    ],
    [
      "watch: gone by then",
      `const undo = noWait(), wait = fail("WaitForSingleObject", 0); const p = Bun.spawn(quick, { stdio: ["ignore", "ignore", "ignore"] }); wait(), undo(); say(typeof (await p.exited));`,
    ],
    [
      "worker with children",
      `const { Worker } = require("worker_threads"); for (let i = 0; i < 5; i++) { const w = new Worker(${JSON.stringify("const f = [process.execPath, '-e', 'setInterval(() => {}, 1000)']; Bun.spawn(f); Bun.$`${f}`.quiet().nothrow().then(); require('child_process').spawn(f[0], f.slice(1)); require('worker_threads').parentPort.postMessage(0);")}, { eval: true }); await once(w, "message"); await w.terminate(); } say("ended");`,
    ],
    [
      "watch: Bun.spawn",
      `const p = during(noWait(), () => Bun.spawn(forever, { stdio: ["ignore", "pipe", "pipe"] })); say([typeof (await settle(p.exited)), await gone(p.pid)]);`,
    ],
    [
      "watch: Bun.spawn, onExit",
      `let seen; const p = during(noWait(), () => Bun.spawn(forever, { onExit: () => (seen = true) })); await settle(p.exited); say([seen, await gone(p.pid)]);`,
    ],
    ["watch: spawnSync", `say(during(noWait(), () => Bun.spawnSync(forever).exitCode));`],
    [
      "watch: shell",
      "const undo = noWait(); const r = await settle(Bun.$`${forever}`.nothrow().quiet().then(it => it.exitCode !== 0)); undo(); say(r);",
    ],
    [
      "watch: child_process",
      `const c = during(noWait(), () => require("child_process").spawn(forever[0], forever.slice(1))); c.on("error", () => {}); await new Promise(r => c.on("close", r)); say(await gone(c.pid));`,
    ],
    [
      "watch: timers go on",
      `const undo = noWait(); const t = performance.now(); await Bun.sleep(30); undo(); say(performance.now() - t >= 29);`,
    ],
    [
      "port: spawnSync",
      `say([during(fail("CreateIoCompletionPort", 0, 8), () => Bun.spawnSync(quick).exitCode), Bun.spawnSync(quick).exitCode]);`,
    ],
    [
      "port: a pipe that cannot be bound",
      `await Bun.spawn(quick).exited; const undo = fail("CreateIoCompletionPort", 0, 8); const text = await Bun.spawn([process.execPath, "-p", "1"]).stdout.text(); undo(); say(text);`,
    ],
    [
      "pipe",
      `say([during(fail("NtCreateNamedPipeFile", NO_RESOURCES), () => Bun.spawn(quick)), await Bun.spawn(quick).exited]);`,
    ],
    ["process", `say([5, 8, 193, 740].map(code => during(fail("CreateProcessW", 0, code), () => Bun.spawn(quick))));`],
    [
      "duplicate",
      `const fd = fs.openSync("file", "r"); const undo = fail("DuplicateHandle", 0, 8); const r = [attempt(() => Bun.spawn(quick, { stdin: fd })), await settle((async () => new Response(Bun.file(fd).stream()).text())()), await settle(Bun.file(fd).text())]; undo(); say(r);`,
    ],
    [
      "kill",
      `const p = Bun.spawn(forever); const r = [during(fail("TerminateProcess", 0, 5), () => p.kill()), during(fail("TerminateProcess", 0, 5), () => process.kill(p.pid))]; p.kill(); await p.exited; say(r);`,
    ],
    [
      "exit code",
      `const p = Bun.spawn(quick); const undo = fail("GetExitCodeProcess", 0, 6); const r = await settle(p.exited); undo(); say(typeof r);`,
    ],
    ["fs.watch: start", `say(during(fail("NtNotifyChangeDirectoryFile", 0xc0000010), () => fs.watch("folder")));`],
    [
      "fs.watch: again",
      `const w = fs.watch("folder"), seen = []; w.on("change", (_, name) => seen.push(name)); const undo = fail("NtNotifyChangeDirectoryFile", 0xc0000022); fs.writeFileSync("folder/y", ""); const [error] = await once(w, "error"); undo(); say([error.code, seen[0]]);`,
    ],
    [
      "adapters",
      `say([232, 1228, 87, 111, 8].map(code => during(fail("GetAdaptersAddresses", code), () => os.networkInterfaces())));`,
    ],
    [
      "cpus",
      `say([during(fail("NtQuerySystemInformation", 0xc0000001), () => os.cpus().map(it => it.model)), os.cpus().length > 0]);`,
    ],
    [
      "registry",
      `os.cpus()[0].model; say(during(fail("RegOpenKeyExW", 2), () => [os.cpus()[0].model, os.cpus()[0].speed, os.version()]));`,
    ],
    [
      "usage",
      `say([during(fail("GetProcessTimes", 0, 5), () => process.cpuUsage()), during(fail("GetThreadTimes", 0, 5), () => process.threadCpuUsage()), during(fail("GetProcessIoCounters", 0, 5), () => process.resourceUsage()), during(fail("GlobalMemoryStatusEx", 0, 5), () => [os.freemem(), os.totalmem()])]);`,
    ],
    [
      "priority",
      `say([during(fail("GetPriorityClass", 0, 5), () => os.getPriority()), during(fail("SetPriorityClass", 0, 5), () => os.setPriority(0))]);`,
    ],
    [
      "POSIX delete",
      `fs.writeFileSync("ro", "", { mode: 0o444 }); fs.mkdirSync("empty"); const undo = failIfFifth("NtSetInformationFile", 64, 0xc00000bb); const r = [attempt(() => fs.unlinkSync("file")), attempt(() => fs.unlinkSync("ro")), attempt(() => fs.rmdirSync("empty")), attempt(() => fs.rmdirSync("folder"))]; undo(); say([r, fs.readdirSync(".").sort()]);`,
    ],
    [
      "any delete",
      `fs.writeFileSync("ro", "", { mode: 0o444 }); const undo = [failIfFifth("NtSetInformationFile", 64, 0xc00000bb), failIfFifth("NtSetInformationFile", 13, 0xc0000121)]; const r = attempt(() => fs.unlinkSync("ro")); undo.reverse().forEach(it => it()); say([r, fs.statSync("ro").mode.toString(8)]);`,
    ],
    [
      "junction",
      `say([during(fail("NtFsControlFile", 0xc0000022), () => fs.symlinkSync(fs.realpathSync("folder"), "link", "junction")), fs.existsSync("link")]);`,
    ],
    [
      "stat of what cannot be opened",
      `const undo = [failTimes("NtCreateFile", 1, 0xc0000022), ...(os.release().split(".")[2] >= 26100 ? [failInPlace("ntdll.dll", "NtQueryInformationByName", 0xc0000022)] : [])]; const r = attempt(() => fs.statSync("file").size); undo.forEach(it => it()); say(r);`,
    ],
    [
      "event",
      `const p = Bun.spawn(forever, { stdio: ["ignore", "ignore", "ignore", "pipe"] }); const fd = fs.createReadStream(null, { windowsHandle: BigInt(p.stdio[3]), autoClose: false }).fd; const undo = fail("CreateEventW", 0, 8); const r = await new Promise(done => fs.write(fd, "x", (error, n) => done(error ? shown(error) : n))); undo(); p.kill(); say(r);`,
    ],
    [
      "thread: one is enough",
      `const fd = fs.openSync("file", "r"), size = fd => new Promise(done => fs.fstat(fd, (_, stat) => done(stat.size))); await size(fd); const undo = fail("CreateThread", 0, 8); const r = await Promise.all(Array.from({ length: 20 }, () => size(fs.openSync("file", "r")))); undo(); say(new Set(r).size);`,
    ],
    ["job", `const p = during(failTimes("CreateProcessW", 1, 0, 5), () => Bun.spawn(quick)); say(await p.exited);`],
    ["no job", `const p = during(fail("CreateJobObjectA", 0, 5), () => Bun.spawn(quick)); say(await p.exited);`],
    [
      "NUL",
      `const undo = fail("CreateFileW", -1, 5); const r = [attempt(() => Bun.spawn([process.execPath, "-e", "0"], { stdio: ["ignore", "inherit", "inherit"] }).exited), attempt(() => Bun.spawn(quick, { stdio: ["inherit", "ignore", "inherit"] }))]; undo(); say([await r[0], r[1]]);`,
    ],
    [
      "read from a child",
      `const p = Bun.spawn([process.execPath, "-p", "1"], { lazy: true }); failTimes("NtReadFile", 1, NO_RESOURCES); say([await settle(p.stdout.text()), typeof (await p.exited)]);`,
    ],
    [
      "write to a child",
      `const p = Bun.spawn(forever, { stdin: "pipe" }); failTimes("NtWriteFile", 1, NO_RESOURCES); const r = await settle(attempt(() => p.stdin.write("x"))); p.kill(); await p.exited; say(shown(r));`,
    ],
    [
      "buffer to a child",
      `failTimes("NtWriteFile", 1, NO_RESOURCES); const p = attempt(() => Bun.spawn([process.execPath, "-e", "console.log((await Bun.stdin.text()).length)"], { stdin: Buffer.alloc(9) })); say(p.stdout ? await p.stdout.text() : p);`,
    ],
    [
      "message to a child",
      `const p = Bun.spawn(forever, { ipc() {} }); await Bun.sleep(50); failTimes("NtWriteFile", 1, NO_RESOURCES); attempt(() => p.send("x")); await Bun.sleep(50); const r = p.connected ?? "n/a"; p.kill(); await p.exited; say(r);`,
    ],
    [
      "shell output",
      "const undo = fail('NtWriteFile', NO_RESOURCES); const r = await settle(Bun.$`echo hi > out.txt`.nothrow().then(it => it.exitCode !== 0)); undo(); say(r);",
    ],
    [
      "worker port",
      `const { Worker } = require("worker_threads"); await once(new Worker("0", { eval: true }), "exit"); say("ok");`,
    ],
    [
      "resolver",
      `say(await Promise.all([11001, 11002, 11003, 10044, 10047, 10109, 10022, 8, 5].map(async code => code)).then(async codes => { const seen = []; await require("dns").promises.lookup("localhost"); for (const code of codes) { const undo = fail("GetAddrInfoW", code); seen.push(await settle(require("dns").promises.lookup("name" + code + ".test"))); undo(); } return seen; }));`,
    ],
    [
      "c-ares socket",
      `const r = new (require("dns").promises.Resolver)({ timeout: 100, tries: 1 }); r.setServers(["127.0.0.1:9"]); const undo = fail("WSAIoctl", -1, 10038); const seen = await settle(r.resolve4("a.test")); undo(); say(seen);`,
    ],
    [
      "socket",
      `using server = Bun.serve({ port: 0, fetch: () => new Response("ok") }); await (await fetch(server.url)).text(); const undo = fail("NtDeviceIoControlFile", NO_RESOURCES); setTimeout(undo, 50); const socket = require("net").connect(server.port, "127.0.0.1"); await once(socket, "connect"); socket.write("GET / HTTP/1.1\\r\\nHost: a\\r\\n\\r\\n"); const [data] = await once(socket, "data"); socket.destroy(); say(String(data).split(" ")[1]);`,
    ],
  ])("%s", async (name, script) => {
    const seen = await run(script);
    console.log("fault", name, JSON.stringify(seen));
    expect(seen).toEqual({ result: expect.not.stringContaining("nothing: "), exitCode: 0 });
  });

  test("no thread at all", async () => {
    const seen = await run(`const fd = fs.openSync("file", "r"); fail("CreateThread", 0, 8); fs.fstat(fd, () => {});`);
    expect(seen.exitCode).toBe(1);
  });

  const heard = `const heard = new Promise(done => process.stdin.on("data", d => done("data " + d)).on("end", () => done("end")).on("error", e => done("error " + e.code))); console.log("ready"); say(await heard); process.exit(0);`;
  test.each([
    [
      "keys: old system",
      `process.stdin.setRawMode(true); require("tty"); process.stdin.on("data", () => {}); const undo = fail("GetProcAddress", 0, 127); process.stdin.once("data", undo); ${heard}`,
      "a",
    ],
    ["peek: gone", `fail("PeekConsoleInputW", 0, 109); ${heard}`, "a\r"],
    ["peek", `fail("PeekConsoleInputW", 0, 5); ${heard}`, "a\r"],
    ["line: gone", `fail("ReadConsoleW", 0, 233); ${heard}`, "a\r"],
    ["line", `fail("ReadConsoleW", 0, 5); ${heard}`, "a\r"],
    ["line: choked", `setTimeout(fail("ReadConsoleW", 0, 87), 300); ${heard}`, "a\r"],
    [
      "keys",
      `process.stdin.setRawMode(true); failInPlace("kernelbase.dll", "ReadConsoleInputExW", 0, 5); ${heard}`,
      "a",
    ],
    ["keys: no wait", `process.stdin.setRawMode(true); noWait(); ${heard}`, "a"],
    ["no CONIN$", `fail("CreateFileW", -1, 5); ${heard}`, "a\r"],
    ["no event", `fail("CreateEventW", 0, 8); ${heard}`, "a\r"],
    [
      "mode",
      `process.stdin.on("error", e => say([e.message, process.stdin.isRaw])); during(fail("SetConsoleMode", 0, 87), () => process.stdin.setRawMode(true)); process.exit(0);`,
      "",
    ],
    [
      "wake",
      `process.stdin.on("data", () => {}); console.log("ready"); await Bun.sleep(400); const undo = fail("WriteConsoleInputW", 0, 5); process.stdin.setRawMode(true); undo(); process.stdin.pause(); say("left");`,
      "ab",
    ],
    [
      "write",
      `const sink = Bun.file(fs.openSync("CONOUT$", "r+")).writer(); const seen = []; for (const code of [6, 8]) seen.push(await settle(during(fail("WriteConsoleW", 0, code), () => Bun.file(fs.openSync("CONOUT$", "r+")).writer().write("x")))); say(seen); process.exit(0);`,
      "",
    ],
    ["read the output", `say(await settle(new Response(Bun.file(fs.openSync("CONOUT$", "r+")).stream()).text()));`, ""],
    [
      "title",
      `say([during(fail("GetConsoleTitleW", 0, 6), () => process.title), during(fail("SetConsoleTitleW", 0, 6), () => (process.title = "x")), process.title]);`,
      "",
    ],
  ])("console: %s", async (name, script, keys) => {
    const seen = await run(script, keys);
    console.log("fault console", name, JSON.stringify(seen));
    expect(seen).toEqual({ result: expect.not.stringContaining("nothing: "), exitCode: 0 });
  });

  const later = `[process.execPath, "-e", "setTimeout(() => process.exit(7), 300)"]`;
  const atOnce = `["cmd.exe", "/c", "exit 7"]`;
  const quietly = `{ stdio: ["ignore", "ignore", "ignore"] }`;
  const spawned = (how: string, cmd: string) =>
    `const p = during(noWait(${how}), () => Bun.spawn(${cmd}, ${quietly})); say([await settle(p.exited), p.exitCode, p.signalCode, await gone(p.pid)]);`;
  const shelled = (how: string, cmd: string) =>
    `const undo = noWait(${how}), cmd = ${cmd}; const r = await settle(Bun.$\`\${cmd}\`.nothrow().quiet().then(it => it.exitCode)); undo(); say(r);`;
  const synced = (how: string, cmd: string) =>
    `say(during(noWait(${how}), () => Bun.spawnSync(${cmd}, { stdout: "pipe", stderr: "pipe" }).exitCode));`;

  test.each([
    ["Bun.spawn", spawned("", "forever"), ["rejected ENOMEM", null, null, true]],
    ["shell", shelled("", "forever"), 1],
    ["spawnSync", synced("", "forever"), "threw ENOMEM"],
    [
      "spawnSync ends it",
      `during(noWait(), () => Bun.spawnSync([process.execPath, "-e", "setTimeout(() => require('fs').writeFileSync('lived', ''), 300)"])); await Bun.sleep(1500); say(fs.existsSync("lived"));`,
      false,
    ],
    [
      "killed in the meantime",
      `const c = new AbortController(), stdin = new ReadableStream({ type: "direct", pull: () => c.abort() }); const p = during(noWait(), () => Bun.spawn(forever, { stdin, signal: c.signal })); say([await settle(p.exited), p.signalCode, await gone(p.pid)]);`,
      [143, "SIGTERM", true],
    ],
    ...(process.arch === "x64"
      ? ([
          ["Bun.spawn, once", spawned("{ once: true }", later), [7, 7, null, true]],
          ["shell, once", shelled("{ once: true }", later), 7],
          ["Bun.spawn, slowly", spawned("{ slowly: 1500 }", atOnce), [7, 7, null, true]],
          ["spawnSync, slowly", synced("{ slowly: 1500 }", atOnce), 7],
        ] as const)
      : []),
  ] as [string, string, unknown][])("unwatched: %s", async (name, script, result) => {
    const seen = await run(script);
    console.log("fault unwatched", name, JSON.stringify(seen));
    expect(seen).toEqual({ result, exitCode: 0 });
  });
});
