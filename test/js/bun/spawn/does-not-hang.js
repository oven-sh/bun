import { shellExe } from "harness";

const s = Bun.spawn({
  cmd: [shellExe(), "sleep", "999999"],
});

s.unref();
