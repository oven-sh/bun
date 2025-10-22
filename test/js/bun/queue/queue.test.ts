import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";

test("Bun.Queue concurrency control", async () => {
  const queue = new Bun.Queue("concurrency-queue", { concurrency: 2 });
  const processingJobs = new Set<number>();
  const maxConcurrent = { current: 0, max: 0 };

  queue.worker(async job => {
    processingJobs.add(job.id);
    maxConcurrent.current = processingJobs.size;
    maxConcurrent.max = Math.max(maxConcurrent.max, processingJobs.size);

    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, 50));

    processingJobs.delete(job.id);
  });

  // Add multiple jobs
  const jobIds = [];
  for (let i = 0; i < 5; i++) {
    const jobId = await queue.add(`concurrent-job-${i}`, { index: i });
    jobIds.push(jobId);
  }

  // Wait for all jobs to complete
  await new Promise<void>(resolve => {
    const checkCompletion = () => {
      if (processingJobs.size === 0 && maxConcurrent.max >= 2) {
        resolve();
      } else {
        setTimeout(checkCompletion, 10);
      }
    };
    setTimeout(checkCompletion, 100);
  });

  // Should have processed jobs with concurrency of 2
  expect(maxConcurrent.max).toBe(2);
  expect(jobIds).toHaveLength(5);
});

test("Bun.Queue pause and resume", async () => {
  const queue = new Bun.Queue("pause-queue");
  const processedJobs: number[] = [];

  queue.worker(async job => {
    processedJobs.push(job.id);
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  // Add first job
  const jobId1 = await queue.add("pause-test-1", { order: 1 });

  // Wait a bit then pause
  await new Promise(resolve => setTimeout(resolve, 5));
  queue.pause();

  // Add second job while paused
  const jobId2 = await queue.add("pause-test-2", { order: 2 });

  // Wait to ensure second job isn't processed
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(processedJobs).toContain(jobId1);
  expect(processedJobs).not.toContain(jobId2);

  // Resume and wait for second job
  queue.resume();

  await new Promise<void>(resolve => {
    const checkCompletion = () => {
      if (processedJobs.includes(jobId2)) {
        resolve();
      } else {
        setTimeout(checkCompletion, 10);
      }
    };
    setTimeout(checkCompletion, 50);
  });

  expect(processedJobs).toEqual([jobId1, jobId2]);
});

test("Bun.Queue statistics", async () => {
  const queue = new Bun.Queue("stats-queue");

  // Initially empty
  let stats = queue.getStats();
  expect(stats.waiting).toBe(0);
  expect(stats.active).toBe(0);
  expect(stats.completed).toBe(0);
  expect(stats.failed).toBe(0);

  // Add jobs
  const jobId1 = await queue.add("stats-job-1", { test: true });
  const jobId2 = await queue.add("stats-job-2", { test: true });

  stats = queue.getStats();
  expect(stats.waiting).toBe(2);

  // Process jobs with one succeeding, one failing
  let jobsProcessed = 0;
  queue.worker(async job => {
    jobsProcessed++;
    if (job.name === "stats-job-1") {
      // Success
    } else {
      throw new Error("Intentional failure");
    }
  });

  // Wait for processing
  await new Promise<void>(resolve => {
    const checkStats = () => {
      stats = queue.getStats();
      if (jobsProcessed >= 2) {
        resolve();
      } else {
        setTimeout(checkStats, 10);
      }
    };
    setTimeout(checkStats, 50);
  });

  stats = queue.getStats();
  expect(stats.completed).toBe(1);
  expect(stats.failed).toBe(1);
  expect(stats.waiting).toBe(0);
});

test("Bun.Queue event handling", async () => {
  const queue = new Bun.Queue("event-queue");
  const events: string[] = [];

  queue.on("job completed", (job, result) => {
    events.push(`completed:${job.id}`);
  });

  queue.on("job failed", (job, error) => {
    events.push(`failed:${job.id}`);
  });

  queue.worker(async job => {
    if (job.name === "success-job") {
      // Success
    } else {
      throw new Error("Test failure");
    }
  });

  const successJobId = await queue.add("success-job", {});
  const failJobId = await queue.add("fail-job", {});

  await new Promise<void>(resolve => {
    const checkEvents = () => {
      if (events.length >= 2) {
        resolve();
      } else {
        setTimeout(checkEvents, 10);
      }
    };
    setTimeout(checkEvents, 100);
  });

  expect(events).toContain(`completed:${successJobId}`);
  expect(events).toContain(`failed:${failJobId}`);
});

test("Bun.Queue job retrieval methods", async () => {
  const queue = new Bun.Queue("retrieval-queue");

  // Add jobs
  const jobId1 = await queue.add("retrieve-job-1", { priority: 1 });
  const jobId2 = await queue.add("retrieve-job-2", { priority: 2 });

  // Get specific job
  const job = queue.getJob(jobId1);
  expect(job).toBeDefined();
  expect(job.id).toBe(jobId1);
  expect(job.data.priority).toBe(1);

  // Get non-existent job
  const nonExistent = queue.getJob(99999);
  expect(nonExistent).toBeNull();

  // Get jobs by type
  const waitingJobs = queue.getJobs("waiting", 0, 10);
  expect(waitingJobs).toHaveLength(2);

  // Remove job
  queue.removeJob(jobId1);
  const removedJob = queue.getJob(jobId1);
  expect(removedJob).toBeNull();
});

test("Bun.Queue close functionality", async () => {
  const queue = new Bun.Queue("close-queue");

  queue.worker(async job => {
    // Worker that takes time
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  const jobId = await queue.add("close-test", {});

  // Close with timeout
  await new Promise<void>(resolve => {
    queue
      .close(200)
      .then(() => resolve())
      .catch(() => resolve());
  });

  // Queue should be closed
  expect(() => queue.add("after-close", {})).toThrow();
});
