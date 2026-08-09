// heavier: lots of module-ish closures + Maps, a local HTTP server after restore, fetch to it, fs work on the thread pool
const reg = new Map(); for (let i = 0; i < 50_000; i++) reg.set("k" + i, { i, f: (x) => x + i, arr: [i, i + 1, i + 2] });
function hot(n) { let s = 0; for (let i = 0; i < n; i++) s += reg.get("k" + (i % 50000)).f(i); return s; }
hot(2_000_000); // tier up before snapshot
async function afterRestore() {
  console.log("[js] epoch", Bun.unsafe.snapshotState().epoch, "hot()", hot(100000));
  const server = Bun.serve({ port: 0, fetch: () => new Response("hello from restored server") });
  const txt = await (await fetch(`http://localhost:${server.port}/`)).text();
  console.log("[js] fetch ->", txt);
  await Bun.write("/tmp/img-heavy.out", "written after restore\n");
  console.log("[js] fs ->", (await Bun.file("/tmp/img-heavy.out").text()).trim());
  const { stdout } = Bun.spawnSync(["uname", "-m"]); console.log("[js] spawn ->", stdout.toString().trim());
  server.stop(true); process.exit(0);
}
process.on("restore", () => { afterRestore().catch(e => { console.error("[js] FAIL", e); process.exit(1); }); });
if (process.env.BUN_IMAGE_OUT) setTimeout(() => Bun.unsafe.snapshot(process.env.BUN_IMAGE_OUT, { timers: "cancel" }), 50);
else afterRestore();
