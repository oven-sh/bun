import { constants } from "node:os";
import { constants as fsConstants } from "node:fs";
console.log(
  typeof constants.signals.SIGINT,
  typeof fsConstants.O_RDONLY,
  typeof process.pid,
  process.platform.length > 0,
  typeof (process as any)._linkedBinding,
);
