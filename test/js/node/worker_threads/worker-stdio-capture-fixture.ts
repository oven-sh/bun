// Intentionally does NOT import node:worker_threads: the stdio capture setup
// must run before user code regardless.
console.log("hello-out");
console.error("hello-err");
process.stdout.write("raw-out\n");
