const memory = process.memoryUsage();
console.log(
  Object.keys(memory).join(),
  memory.rss > 0,
  process.memoryUsage.rss() > 0,
  Object.keys(process.cpuUsage()).join(),
  Object.keys((process as any).threadCpuUsage()).join(),
  process.resourceUsage().maxRSS > 0,
  process.uptime() >= 0,
  process.availableMemory() > 0,
  typeof process.constrainedMemory(),
);
