// Usage: bun startup.js name=path ...   What it costs to start each program, where it is and as a new copy, and which pages of it a process holds.
const fs = require("fs"), os = require("os"), path = require("path"), { dlopen, ptr, read } = require("bun:ffi");
const k = dlopen("kernel32.dll", {
  OpenProcess: { args: ["u32", "i32", "u32"], returns: "i64" },
  CloseHandle: { args: ["i64"], returns: "i32" },
  WaitForSingleObject: { args: ["i64", "u32"], returns: "u32" },
  QueryProcessCycleTime: { args: ["i64", "ptr"], returns: "i32" },
  K32GetProcessMemoryInfo: { args: ["i64", "ptr", "u32"], returns: "i32" },
  K32EnumProcessModules: { args: ["i64", "ptr", "u32", "ptr"], returns: "i32" },
  K32QueryWorkingSetEx: { args: ["i64", "ptr", "u32"], returns: "i32" },
  GetProcessTimes: { args: ["i64", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
  LoadLibraryExW: { args: ["ptr", "i64", "u32"], returns: "u64" },
}).symbols;
function layout(file) {
  const fd = fs.openSync(file, "r"), head = Buffer.alloc(4096);
  fs.readSync(fd, head, 0, 4096, 0), fs.closeSync(fd);
  const pe = head.readUInt32LE(0x3c), table = pe + 24 + head.readUInt16LE(pe + 20);
  const sections = Array.from({ length: head.readUInt16LE(pe + 6) }, (_, i) => table + i * 40).map(at => ({ name: head.toString("latin1", at, at + 8).replace(/\0+$/, ""), size: head.readUInt32LE(at + 8), start: head.readUInt32LE(at + 12), flags: head.readUInt32LE(at + 36) }));
  return { sections, size: head.readUInt32LE(pe + 24 + 56), alignment: head.readUInt32LE(pe + 24 + 32), characteristics: head.readUInt16LE(pe + 24 + 70) };
}
if (process.argv[2] === "--touch") {
  // Reads every page of the image, through the same section that a process of it is mapped from.
  const file = process.argv[3], base = Number(k.LoadLibraryExW(Buffer.from(file + "\0", "utf16le"), 0n, 0x20) & ~3n);
  let pages = 0;
  if (base) for (const { start, size } of layout(file).sections) for (let at = 0; at < size; at += 4096) read.u8(base + start, at), pages++;
  console.log(pages);
  for await (const _ of process.stdin);
  process.exit(0);
}
const sites = process.argv.slice(2).filter(it => it.includes("=")).map(it => ({ name: it.slice(0, it.indexOf("=")), file: it.slice(it.indexOf("=") + 1) })), RUNS = +(process.env.RUNS ?? 31);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "startup-")), env = { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" };
fs.writeFileSync(root + "\\empty.js", ""), fs.writeFileSync(root + "\\idle.js", "console.log(1); setInterval(() => {}, 1000);");
const commands = { "--version": ["--version"], "-e 1": ["-e", "1"], "build": ["build", "empty.js"] };
function once(file, args) {
  const start = Bun.nanoseconds(), child = Bun.spawn([file, ...args], { cwd: root, env, stdio: ["ignore", "ignore", "ignore"] }), handle = k.OpenProcess(0x101410, 0, child.pid);
  k.WaitForSingleObject(handle, 20000);
  const ms = (Bun.nanoseconds() - start) / 1e6, cycles = new BigUint64Array(1), memory = Buffer.alloc(72);
  k.QueryProcessCycleTime(handle, cycles), k.K32GetProcessMemoryInfo(handle, memory, 72), k.CloseHandle(handle);
  return { ms, cycles: Number(cycles[0]) / 1e6, faults: memory.readUInt32LE(4), peak: Number(memory.readBigUInt64LE(8)) / 1e6 };
}
async function pages(file) {
  const child = Bun.spawn([file, "idle.js"], { cwd: root, env, stdio: ["ignore", "pipe", "ignore"] });
  await child.stdout.getReader().read(), await Bun.sleep(150);
  const handle = k.OpenProcess(0x410, 0, child.pid), modules = new BigUint64Array(1), { sections, size } = layout(file), count = Math.ceil(size / 4096), table = new BigUint64Array(count * 2);
  k.K32EnumProcessModules(handle, modules, 8, new Uint32Array(1));
  for (let i = 0; i < count; i++) table[i * 2] = modules[0] + BigInt(i * 4096);
  const ok = k.K32QueryWorkingSetEx(handle, table, table.byteLength);
  k.CloseHandle(handle), child.kill(), await child.exited;
  if (!ok) return "no answer";
  return sections.filter(it => it.size > 400000).map(({ name, start, size }) => {
    let held = 0, resident = 0, runs = 0, large = 0, before = false;
    const blocks = new Set();
    for (let i = start / 4096; i < (start + size) / 4096; i++) {
      const bits = Number(table[i * 2 + 1] & 0xffffffffn), valid = !!(bits & 1);
      if (valid) held++, blocks.add(i >> 4), (runs += +!before), (large += (bits >>> 23) & 1);
      else if (((bits >>> 22) & 3) === 1) resident++;
      before = valid;
    }
    return `${name} ${held} of ${Math.ceil(size / 4096)} in ${runs} runs, ${blocks.size} blocks of 64 K, ${resident} more in memory${large ? `, ${large} large` : ""}`;
  }).join(" | ");
}
async function measure(title, list) {
  console.log(`\nstart: ${title}. Medians of ${RUNS}: ms, million cycles, page faults, peak working set in MB`);
  for (const [name, args] of Object.entries(commands)) {
    const seen = list.map(() => []);
    for (let run = -2; run < RUNS; run++) { for (let turn = 0; turn < list.length; turn++) { const i = (turn + run + 2) % list.length, it = once(list[i].file, args); if (run >= 0) seen[i].push(it); } await Bun.sleep(0); }
    const median = (l, key) => l.map(it => it[key]).sort((a, b) => a - b)[l.length >> 1], high = l => l.map(it => it.ms).sort((a, b) => a - b)[Math.floor(l.length * 0.9)];
    console.log("start " + name.padEnd(10), list.map((it, i) => `${it.name} ${median(seen[i], "ms").toFixed(1)} (p90 ${high(seen[i]).toFixed(1)}), ${median(seen[i], "cycles").toFixed(0)}, ${median(seen[i], "faults")}, ${median(seen[i], "peak").toFixed(0)}`.padEnd(46)).join(""));
  }
  for (const it of list) console.log(`start pages of ${it.name}: ${await pages(it.file)}`);
}
for (const it of sites) { const { sections, size, alignment, characteristics } = layout(it.file); console.log(`start ${it.name}: ${Bun.spawnSync([it.file, "--revision"]).stdout.toString().trim()}, file ${fs.statSync(it.file).size}, image ${size}, alignment ${alignment}, dll flags 0x${characteristics.toString(16)}, ${sections.map(s => `${s.name} ${s.size}`).join(", ")}`); }
await measure("where they are", sites);
const copies = sites.map((it, i) => { fs.mkdirSync(`${root}\\${i}`), fs.copyFileSync(it.file, `${root}\\${i}\\bun.exe`); return { name: it.name, file: `${root}\\${i}\\bun.exe` }; });
await Bun.sleep(3000);
await measure("new copies", copies);
const holders = copies.map(it => Bun.spawn([process.execPath, import.meta.path, "--touch", it.file], { stdio: ["pipe", "pipe", "inherit"] }));
console.log("\nstart: pages touched:", (await Promise.all(holders.map(async it => Buffer.from((await it.stdout.getReader().read()).value ?? []).toString().trim()))).join());
await measure("new copies, while another process holds every page", copies);
for (const it of holders) it.stdin.end(), await it.exited;
await measure("new copies, after that process has ended", copies);
// What the system learns from programs that do many different things in their first seconds.
fs.writeFileSync(root + "\\wide.js", `for (const m of require("module").builtinModules) try { require(m); } catch {}
  Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") }).stop(); new Intl.DateTimeFormat("ja").format(0); Bun.gzipSync("x"); Bun.zstdCompressSync("x"); await Bun.build({ entrypoints: [__filename], target: "bun", minify: true });
  new (require("bun:sqlite").Database)(":memory:").query("select 1").get(); await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]); new HTMLRewriter().transform("<a>"); Bun.TOML.parse("a=1"); Bun.YAML.parse("a: 1"); await Bun.$\`echo\`.quiet();
  let x = 0; for (let i = 0; i < 3e7; i++) x += Math.sqrt(i); process.exit(0);`);
fs.writeFileSync(root + "\\a.test.js", `const { test, expect } = require("bun:test"); test("a", () => expect({ a: 1 }).toEqual({ a: 1 }));`);
for (let i = 0; i < +(process.env.WORKOUT ?? 12); i++) for (const it of copies) for (const args of [["wide.js"], ["test"], ["build", "wide.js", "--target=bun"]]) once(it.file, args);
await Bun.sleep(+(process.env.SETTLE ?? 12000));
await measure("new copies, after they have done many things", copies);
await measure("where they are, once more", sites);
try { console.log("start prefetch files:", fs.readdirSync("C:\\Windows\\Prefetch").filter(it => /^BUN/i.test(it)).map(it => `${it} ${fs.statSync("C:\\Windows\\Prefetch\\" + it).size}`).join(", ")); } catch (error) { console.log("start prefetch files:", error.code); }
console.log("start settings:", Bun.spawnSync(["reg", "query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters"]).stdout.toString().replace(/\s+/g, " "), Bun.spawnSync(["sc", "query", "SysMain"]).stdout.toString().match(/STATE.*/)?.[0].replace(/\s+/g, " "));
try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } catch {}
