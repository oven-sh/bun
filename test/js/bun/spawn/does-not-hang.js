import { shellExe } from "harness";

const s = Bun.spawn({
  cmd: [shellExe(), "-c", "sleep 999999"],
});

s.unref();
