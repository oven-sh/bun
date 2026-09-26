import { shellExe } from "harness";

// The child must not inherit our stdout/stderr pipes, or the test reading them
// would wait on the child we deliberately leave behind.
const s = Bun.spawn({
  cmd: [shellExe(), "-c", "sleep 999999"],
  stdio: ["ignore", "ignore", "ignore"],
});

s.unref();
console.log(s.pid);
