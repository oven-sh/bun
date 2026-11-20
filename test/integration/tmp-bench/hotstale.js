// bun hotstale.js <times>: the steps of a test in hot.test.ts. Where it stops, it says what each side saw last.
const fs = require("fs"), os = require("os"), path = require("path"), seen = new Map(), spam = ("//" + "B".repeat(2000) + "\n").repeat(1000);
for (let round = 0, shown = 0; round < +process.argv[2]; round++) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hotstale-")), file = path.join(dir, "root.js"), trace = dir + ".trace", start = performance.now(), steps = [];
  const at = text => steps.push(`${(performance.now() - start).toFixed(1)} ${text}`);
  const write = n => {
    fs.writeFileSync(file + ".next", `// source content\n${spam}require("fs").writeFileSync(__filename, "// stub ${n}\\n");\nthrow new Error('${n}');`);
    try { fs.rmSync(file); } catch (error) { at("rm " + error.code); }
    fs.renameSync(file + ".next", file), at("wrote " + n);
  };
  write(0);
  const child = Bun.spawn([process.execPath, "--smol", "--hot", "run", file], { cwd: dir, env: { ...process.env, BUN_WATCHER_TRACE: trace, NO_COLOR: "1" }, stdio: ["ignore", "ignore", "pipe"] }), reader = child.stderr.getReader();
  let result = "done", n = 0, text = "";
  try {
    while (n < 20) {
      const { value, done } = await Promise.race([reader.read(), Bun.sleep(6000).then(() => ({ done: "stalled" }))]);
      if (done) { result = done === true ? "ended" : done; break; }
      const lines = (text + Buffer.from(value).toString()).split("\n");
      text = lines.pop();
      let again = false;
      for (const line of lines.filter(it => it.includes("error:"))) at("heard " + line.slice(0, 60).trim()), line.includes(`error: ${n}`) ? (n++, (again = true)) : line.includes(`error: ${n - 1}`) && (again = true);
      if (again && n < 20) write(n);
    }
  } catch (error) { result = "threw " + error.code + " " + error.syscall; }
  if (result === "stalled") result += ", the file is " + (fs.statSync(file).size > 1000 ? "whole" : "the stub") + ", last " + steps.findLast(it => it.includes("heard"))?.replace(/^\S+ heard /, "").replace(/\d+|".*/g, "");
  if (result !== "done" && shown++ < 2) console.log(`   ${steps.slice(-6).join(" | ")}\n   ${fs.readFileSync(trace, "utf8").trim().split("\n").slice(-6).map(it => it.replaceAll(path.basename(dir), "D").replace(/[A-Z]:[^"]*?D/g, "D").slice(0, 170)).join("\n   ")}`);
  child.kill(), await child.exited, seen.set(result, (seen.get(result) ?? 0) + 1);
  try { fs.rmSync(dir, { recursive: true, force: true }), fs.rmSync(trace, { force: true }); } catch {}
}
console.log([...seen].map(([text, count]) => `${count} x ${text}`).join("; "));
