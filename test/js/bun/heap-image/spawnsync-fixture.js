const { spawnSync } = require("child_process");
const run = (tag) => {
  const opts = [
    ["default", {}],
    ["stdio-ignore-pipe-pipe", { stdio: ["ignore", "pipe", "pipe"] }],
    ["shell+ignore", { shell: "/bin/sh", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1_000_000, timeout: 600000 }],
    ["shell+pipe-in", { shell: "/bin/sh", stdio: ["pipe", "pipe", "pipe"], input: "" }],
  ];
  for (const [name, o] of opts) {
    const r = o.shell ? spawnSync("echo out; echo err 1>&2", o) : spawnSync("/bin/sh", ["-c", "echo out; echo err 1>&2"], o);
    console.log(`[js] ${tag} ${name}: status=${r.status} stdout=${JSON.stringify(String(r.stdout ?? ""))} stderr=${JSON.stringify(String(r.stderr ?? ""))} err=${r.error?.code ?? "-"}`);
  }
};
if (!process.env.SKIP_BUILD_RUN) { try { run("build"); } catch (e) { console.log("[js] build run threw", String(e.message).slice(0, 50)); } }
process.on("restore", () => { run("restored"); process.exit(0); });
setTimeout(() => Bun.unsafe.snapshot(process.env.BUN_IMAGE_OUT, { timers: "keep" }), 50);
