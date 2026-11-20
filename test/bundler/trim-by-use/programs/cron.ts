// Bun.cron: the parser and a job in this process
console.log(Bun.cron.parse("*/15 3 * * 1", new Date(Date.UTC(2026, 0, 1)))?.toISOString());
console.log(Bun.cron.parse("0 0 29 2 *", new Date(Date.UTC(2026, 0, 1)))?.toISOString());
try {
  Bun.cron.parse("61 * * * *");
} catch (error) {
  console.log("refused:", (error as Error).name);
}
const job = Bun.cron("* * * * *", () => {});
console.log(job.cron, typeof job.stop, typeof job.ref);
job.unref();
job.stop();
console.log("stopped");
