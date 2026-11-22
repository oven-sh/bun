// Usage: bun three.js <old> <new> <script> <variant;...> <args...>   For the scripts that take name=exe[=variant].
const [old, now, script, variants, ...args] = process.argv.slice(2);
await Bun.spawn([old, import.meta.dir + "/" + script, ...args, "old=" + old, ...variants.split(";").map(v => (v === "before" ? "before=" + process.env.BEFORE_BUN : v ? `${v}=${now}=${v}` : "new=" + now))], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ONLY: "^(read|text|immediate|no compute)$" } }).exited;
