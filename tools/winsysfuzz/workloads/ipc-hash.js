// Stateful IPC workload: spawn several bun children over IPC, ship each a
// batch of payloads, and require every child to echo back a hash the parent
// verifies. Pipes + IPC framing + child lifecycle all under fault; any
// echoed hash mismatch is silent corruption (WSF-CORRUPTION).
console.log("STAGE: setup");
const { createHash } = require("node:crypto");
const N_CHILD = 3;
const BATCH = 12;
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 16);
if (process.env.WSF_CHILD === "1") {
  // child: echo the hash of every message received
  process.on("message", m => {
    if (m === "done") process.exit(0);
    process.send({ id: m.id, h: hash(m.data) });
  });
  await new Promise(() => {}); // stay alive until told
}
console.log("STAGE: spawn");
let corrupt = 0;
let echoed = 0;
const perChild = new Map();
const echoedFor = k => perChild.get(k) ?? 0;
async function drive(k) {
  const child = Bun.spawn({
    cmd: [process.execPath, import.meta.path],
    env: { ...process.env, WSF_CHILD: "1" },
    ipc(msg) {
      const want = expect.get(msg.id);
      echoed++;
      perChild.set(k, echoedFor(k) + 1);
      if (want === undefined) console.log(`WSF-CORRUPTION: child ${k} echoed unknown id ${msg.id}`), corrupt++;
      else if (msg.h !== want) console.log(`WSF-CORRUPTION: child ${k} id ${msg.id} hash ${msg.h} != ${want}`), corrupt++;
    },
    stdout: "ignore",
    stderr: "inherit",
  });
  const expect = new Map();
  for (let i = 0; i < BATCH; i++) {
    const data = `payload-${k}-${i}-` + "z".repeat(500 + i * 37);
    expect.set(i, hash(data));
    child.send({ id: i, data });
  }
  // poll (bounded) for the echoes rather than sleep on a timer
  for (let t = 0; t < 400 && echoedFor(k) < BATCH; t++) await Bun.sleep(10);
  try {
    child.send("done");
  } catch {}
  await child.exited.catch(() => {});
}
await Promise.all(Array.from({ length: N_CHILD }, (_, k) => drive(k)));
console.log("STAGE: verify");
console.log(`ipc-hash ok children=${N_CHILD} echoed=${echoed} corrupt=${corrupt}`);
