// How do 1 ms timers fare next to tests that keep the machine busy?
const fs = require("fs"), os = require("os"), path = require("path");
const [old, now] = process.argv.slice(2), root = path.join(import.meta.dir, "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neighbours-"));
fs.writeFileSync(path.join(dir, "b.test.ts"), `
  import { expect, test, vi } from "bun:test";
  test("b", async () => {
    const at = [], cpu = process.cpuUsage();
    await vi.waitFor(() => (at.push(performance.now()), expect(at.length).toBe(40)), { interval: 1, timeout: 4000 });
    const gaps = at.slice(1).map((it, i) => it - at[i]), used = process.cpuUsage(cpu);
    console.log("GAPS", JSON.stringify({ started: Math.round(at[0]), total: Math.round(at.at(-1) - at[0]), cpu: (used.user + used.system) / 1000, gaps: gaps.map(it => Math.round(it)).join(" ") }));
  });`);
const env = { ...process.env, BUN_GARBAGE_COLLECTOR_LEVEL: "1", NO_COLOR: "1" };
for (const [name, exe] of [["old", old], ["new", now], ["old", old], ["new", now]]) {
  let isOver = false, failed = 0, runs = 0;
  const seen = [], until = Date.now() + 40000;
  const repeat = async f => { while (Date.now() < until) await f(); };
  await Promise.all([
    repeat(() => Bun.spawn([exe, "test", "test/bake/dev/production.test.ts"], { cwd: root, env, stdio: ["ignore", "ignore", "ignore"], timeout: 45000 }).exited),
    repeat(async () => { const p = Bun.spawn([exe, "test", "test/js/bun/test/vi-utils.test.ts", "-t", "a wait that is still pending"], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] }); const text = await p.stderr.text(); runs++; if (await p.exited) failed++, failed < 2 && console.log(name, "FAILED", text.slice(-500)); }),
    repeat(async () => { const text = await Bun.spawn([exe, "test", "./b.test.ts"], { cwd: dir, env, stderr: "ignore" }).stdout.text(); const line = /GAPS (.*)/.exec(text); if (line) seen.push(JSON.parse(line[1])); }),
  ]);
  seen.sort((a, b) => a.total - b.total);
  console.log("neighbours", name, `vi-utils failed ${failed} of ${runs}; 40 polls: n=${seen.length} p50=${seen[seen.length >> 1]?.total} p90=${seen[(seen.length * 0.9) | 0]?.total} max=${seen.at(-1)?.total}`);
  for (const it of seen.slice(-3)) console.log("neighbours   worst", JSON.stringify(it));
}
