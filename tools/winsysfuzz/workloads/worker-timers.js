// scenario: worker threads + timers + event synchronization — thread creation,
// events/waits, and the timer syscalls (NtCreateThreadEx, NtSetTimerEx, ...)
const { Worker } = require("worker_threads");

const results = await Promise.all(
  [0, 1, 2].map(
    i =>
      new Promise((resolve, reject) => {
        const w = new Worker(
          `const {parentPort, workerData}=require("worker_threads");
           let s=0; for (let k=0;k<1e6;k++) s+=k%7;
           parentPort.postMessage(workerData.id + ":" + (s>0));`,
          { eval: true, workerData: { id: i } },
        );
        w.once("message", m => {
          resolve(m);
          w.terminate();
        });
        w.once("error", reject);
      }),
  ),
);

// timers: interval + timeouts interleaved
let ticks = 0;
await new Promise(resolve => {
  const iv = setInterval(() => {
    ticks++;
    if (ticks === 4) {
      clearInterval(iv);
      resolve();
    }
  }, 15);
});
const t0 = Bun.nanoseconds();
await Bun.sleep(30);
const slept = (Bun.nanoseconds() - t0) / 1e6;

console.log(`worker ok ${results.join(",")} ticks=${ticks} slept=${Math.round(slept)}ms`);
