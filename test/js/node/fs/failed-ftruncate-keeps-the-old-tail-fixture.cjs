// usage: bun failed-ftruncate-keeps-the-old-tail-fixture.cjs      (also runs on node; Linux; needs strace and python3; no network; files only in a fresh temp directory; ERRNO=ESTALE sets the errno of door 1)
// A file of 5,000 old bytes is replaced by 3,000 new ones. bun opens it without O_TRUNC, writes, and cuts the file afterwards with ftruncate(2). That one call fails.
// Door 1: strace makes ftruncate(2) on that one path fail with EIO:  strace -e trace=ftruncate -e inject=ftruncate:error=EIO -P <path> <runtime> <this file> <api> <path>
// Door 2: no tracer: a Landlock sandbox (Linux 6.2+) that allows every write and refuses truncation: the kernel itself answers EACCES. Skipped where Landlock is missing.
// exit 86 = at least one API reports success and the file holds the new bytes followed by the tail of the old file; exit 0 = every API either fails or leaves exactly the new bytes
// exit 2 = a control failed (no fault: every API succeeds and the file holds exactly the new bytes).
const fs = require("node:fs"),
  fsp = require("node:fs/promises"),
  cp = require("node:child_process"),
  os = require("node:os"),
  path = require("node:path");
const [, me, api, p] = process.argv,
  E = process.env.ERRNO || "EIO",
  NEW = "n".repeat(3000),
  OLD = "o".repeat(5000),
  cb = f => new Promise((ok, no) => f(e => (e ? no(e) : ok())));
const API = {
  "fs.writeFileSync(p, data)": () => fs.writeFileSync(p, NEW),
  "fs.writeFile(p, data, cb)": () => cb(c => fs.writeFile(p, NEW, c)),
  "await fsp.writeFile(p, data)": () => fsp.writeFile(p, NEW),
  "fs.copyFileSync(src, p)": () => fs.copyFileSync(p + ".src", p),
  "await fsp.copyFile(src, p)": () => fsp.copyFile(p + ".src", p),
  "fs.cpSync(src, p)": () => fs.cpSync(p + ".src", p),
  "await fsp.cp(src, p)": () => fsp.cp(p + ".src", p),
  "fs.createWriteStream(p).end(data)": () =>
    new Promise((ok, no) => fs.createWriteStream(p).on("error", no).on("close", ok).end(NEW)),
  "h = await fsp.open(p, 'w'); await h.writeFile(data)": async () => {
    const h = await fsp.open(p, "w");
    try {
      await h.writeFile(NEW);
    } finally {
      await h.close();
    }
  },
};
if (globalThis.Bun)
  Object.assign(API, {
    "await Bun.write(p, data)": () => Bun.write(p, NEW),
    "await Bun.write(p, new Response(data))": () => Bun.write(p, new Response(NEW)),
    "await Bun.write(p, Bun.file(src))": () => Bun.write(p, Bun.file(p + ".src")),
  });
if (api) {
  Promise.resolve()
    .then(API[api])
    .then(
      () => console.log("reports success"),
      e => console.log("fails " + e.code),
    )
    .then(() => process.exit(0));
  return;
}
const LL = `
import ctypes, os, sys, struct
c = ctypes.CDLL(None, use_errno=True); T = 1 << 14  # LANDLOCK_ACCESS_FS_TRUNCATE
if c.syscall(444, None, 0, 1) < 3: sys.exit(3)      # landlock_create_ruleset(NULL, 0, VERSION): truncation is a right since ABI 3
a = struct.pack("Q", T); fd = c.syscall(444, a, len(a), 0)   # the ruleset handles truncation alone and holds no rule: refused everywhere, all else untouched
c.prctl(38, 1, 0, 0, 0)                              # PR_SET_NO_NEW_PRIVS
if fd < 0 or c.syscall(446, fd, 0) < 0: sys.exit(3)  # landlock_restrict_self
os.execv(sys.argv[1], sys.argv[1:])
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ftrunc-"));
let n = 0,
  ctl = true,
  bad = [0, 0],
  ran2 = 0;
const disk = f => {
  if (!fs.existsSync(f)) return "no file";
  const s = fs.readFileSync(f, "utf8");
  return s === NEW
    ? "the new bytes"
    : s === NEW + OLD.slice(3000)
      ? "3,000 NEW BYTES + 2,000 OLD ONES"
      : s === OLD
        ? "the old file"
        : `${s.length} bytes`;
};
const run = (name, door) => {
  const f = path.join(dir, "f" + n++);
  fs.writeFileSync(f, OLD);
  fs.writeFileSync(f + ".src", NEW);
  const tail = [process.execPath, me, name, f];
  const argv =
    door === 1
      ? [
          "strace",
          "-f",
          "-o",
          f + ".log",
          "-e",
          "trace=ftruncate",
          "-e",
          `inject=ftruncate:error=${E}`,
          "-P",
          f,
          ...tail,
        ]
      : door === 2
        ? ["python3", "-c", LL, ...tail]
        : tail;
  const x = cp.spawnSync(argv[0], argv.slice(1), { encoding: "utf8" });
  if (door === 2 && x.status === 3) return null;
  return [String(x.stdout).trim().split("\n").pop(), disk(f)];
};
for (const name of Object.keys(API)) {
  const plain = run(name, 0),
    d1 = run(name, 1),
    d2 = run(name, 2);
  if (plain[0] !== "reports success" || plain[1] !== "the new bytes") ctl = false;
  for (const [i, d] of [
    [0, d1],
    [1, d2],
  ])
    if (d && d[0] === "reports success" && d[1] !== "the new bytes") bad[i]++;
  if (d2) ran2++;
  console.log(
    `${name.padEnd(56)} ftruncate fails ${E}: ${d1[0]}; on disk: ${d1[1]} | Landlock: ${d2 ? d2[0] + "; on disk: " + d2[1] : "skipped"}`,
  );
}
fs.rmSync(dir, { recursive: true, force: true });
const N = Object.keys(API).length;
if (!ctl) {
  console.log("RESULT: a control failed");
  process.exit(2);
}
if (bad[0] || bad[1]) {
  console.log(
    `RESULT: broken: a success is reported over a file with the old tail: ${bad[0]} of ${N} APIs with the injected ${E}, ${bad[1]} of ${ran2} in the Landlock sandbox`,
  );
  process.exit(86);
}
console.log("RESULT: holds: every API fails or leaves exactly the new bytes");
process.exit(0);
