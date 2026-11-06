// node:os
import os from "node:os";
console.log(
  os.cpus().length > 0,
  os.totalmem() > os.freemem(),
  typeof os.hostname(),
  os.loadavg().length,
  os.uptime() > 0,
  typeof os.release(),
  typeof os.version(),
  os.homedir().length > 0,
  os.userInfo().uid >= 0,
  "lo" in os.networkInterfaces(),
  os.getPriority() <= 19,
  os.availableParallelism() > 0,
);
