// The process ends while eight Workers are busy in compiled code, in collections, in native calls, or still starting: by process.exit, by the end of the program with unref'd Workers, by an uncaught throw, by a signal. The program runs itself as a child for each way, several times, and reports how each child ended.
type Cell = { id: number; next: Cell | null; text: string };
function churn(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    let head: Cell | null = null;
    for (let i = 0; i < 2000; i++) head = { id: i, next: head, text: "c" + i };
    for (let at = head; at; at = at.next) sum += at.id + at.text.length;
  }
  return sum;
}
const ways = ["exit at once", "exit when all run", "exit 7 in a message listener", "ends with unref'd workers", "throws", "rejects", "SIGTERM", "SIGKILL", "exit while they start and end"];

if (!Bun.isMainThread) {
  const kind = Number(process.env.KIND);
  postMessage("runs");
  if (process.env.WAY === "exit while they start and end") process.exit(0);
  for (let round = 0; ; round++) {
    if (kind % 4 === 0) churn(5);
    else if (kind % 4 === 1) churn(1), Bun.gc(true);
    else if (kind % 4 === 2) JSON.parse(JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ i, text: "t" + i }))));
    else for (let i = 0; i !== 50_000_000; i = (i + 1) | 0);
  }
} else if (process.env.WAY) {
  const way = process.env.WAY;
  let running = 0;
  const start = (kind: number) => {
    const worker = new Worker(new URL(import.meta.url), { env: { ...process.env, KIND: String(kind) } as any });
    worker.onmessage = () => {
      if (++running !== 8 || way === "exit while they start and end" || way === "ends with unref'd workers") return;
      console.log("all run");
      if (way === "exit when all run") setTimeout(() => process.exit(0), 5);
      else if (way === "exit 7 in a message listener") process.exit(7);
      else if (way === "throws") throw new Error("thrown on the main thread");
      else if (way === "rejects") Promise.reject(new Error("rejected on the main thread"));
      else if (way === "SIGTERM" || way === "SIGKILL") process.kill(process.pid, way);
    };
    return worker;
  };
  if (way === "exit while they start and end") {
    for (let round = 0; round < 6; round++) for (let kind = 0; kind < 8; kind++) start(kind);
    setTimeout(() => process.exit(0), Number(process.env.DELAY));
  } else {
    const workers = Array.from({ length: 8 }, (_, kind) => start(kind));
    if (way === "exit at once") process.exit(0);
    if (way === "ends with unref'd workers") for (const worker of workers) (worker as any).unref();
  }
} else {
  const self = process.argv[1].includes("$bunfs") || process.argv[1].includes("~BUN") ? [process.execPath] : [process.execPath, process.argv[1]];
  const rounds = Number(process.env.COUNT ?? 2);
  for (const way of ways) {
    const ended = new Map<string, number>();
    await Promise.all(Array.from({ length: rounds }, async (_, round) => {
      const child = Bun.spawn(self, { env: { ...process.env, WAY: way, DELAY: String(round * 3) }, stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      await child.exited;
      const bad = /panic|Segmentation|ASSERT|Sanitizer|oh no|FATAL|Illegal|abort/i.exec(err)?.[0] ?? "";
      const key = `exit ${child.exitCode} signal ${child.signalCode} ${out.trim()} ${bad}`.trim();
      ended.set(key, (ended.get(key) ?? 0) + 1);
    }));
    console.log(way + ":", [...ended.keys()].sort().join(" || "));
  }
}
