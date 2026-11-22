// Usage: bun three.js <old> <new> <script> <args...>   For the scripts that take name=exe.
const [old, now, script, ...args] = process.argv.slice(2);
await Bun.spawn([old, import.meta.dir + "/" + script, ...args, "old=" + old, "before=" + process.env.BEFORE_BUN, "new=" + now], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ONLY: "^(read|text|immediate|no compute)$" } }).exited;
