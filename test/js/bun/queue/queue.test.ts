import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";

test("Bun.Queue constructor", () => {
  const queue = new Bun.Queue("test-queue");
  expect(queue).toBeDefined();
});

test("Bun.Queue constructor with options", () => {
  const queue = new Bun.Queue("test-queue", {
    storage: "memory",
    concurrency: 1,
  });
  expect(queue).toBeDefined();
});

test("Bun.Queue constructor with invalid storage", () => {
  expect(() => {
    new Bun.Queue("test-queue", {
      storage: "sqlite" as any,
    });
  }).toThrow("SQLite storage is not yet implemented");
});

test("Bun.Queue constructor with invalid options", () => {
  expect(() => {
    new Bun.Queue("test-queue", "invalid" as any);
  }).toThrow("Queue options must be an object");

  expect(() => {
    new Bun.Queue("test-queue", {
      storage: 123 as any,
    });
  }).toThrow("Storage option must be a string");

  expect(() => {
    new Bun.Queue("test-queue", {
      concurrency: "invalid" as any,
    });
  }).toThrow("Concurrency option must be a number");

  expect(() => {
    new Bun.Queue("test-queue", {
      concurrency: 0,
    });
  }).toThrow("Concurrency must be between 1 and 100");
});

test("Bun.Queue add job", async () => {
  const queue = new Bun.Queue("test-queue");
  const jobId = await queue.add("test-job", { message: "hello world" });
  expect(typeof jobId).toBe("number");
  expect(jobId).toBeGreaterThan(0);
});

test("Bun.Queue add job with invalid arguments", async () => {
  const queue = new Bun.Queue("test-queue");

  expect(() => queue.add()).toThrow("add() requires a job name as the first argument");
  expect(() => queue.add(123 as any)).toThrow("Job name must be a string");
  expect(() => queue.add("test-job")).toThrow("add() requires job data as the second argument");
});

test("Bun.Queue worker with invalid callback", () => {
  const queue = new Bun.Queue("test-queue");

  expect(() => queue.worker()).toThrow("worker() requires a callback function");
  expect(() => queue.worker("not a function" as any)).toThrow("Worker callback must be a function");
});

test("Bun.Queue basic job processing", async () => {
  const queue = new Bun.Queue("test-queue");
  let processedJob: any = null;
  let processingComplete = false;

  queue.worker(async job => {
    processedJob = job;
    processingComplete = true;
  });

  const jobId = await queue.add("test-job", { message: "hello world" });

  await new Promise<void>(resolve => {
    const checkProcessing = () => {
      if (processingComplete) {
        resolve();
      } else {
        setTimeout(checkProcessing, 10);
      }
    };
    checkProcessing();
  });

  expect(processedJob).toBeDefined();
  expect(processedJob.id).toBe(jobId);
  expect(processedJob.name).toBe("test-job");
  expect(processedJob.data).toEqual({ message: "hello world" });
  expect(typeof processedJob.done).toBe("function");
  expect(typeof processedJob.retry).toBe("function");
});

test("Bun.Queue worker error handling", async () => {
  const queue = new Bun.Queue("test-queue");
  let jobCount = 0;
  let lastJob: any = null;

  queue.worker(async job => {
    jobCount++;
    lastJob = job;
    if (jobCount === 1) {
      throw new Error("Simulated job failure");
    }
  });

  const jobId = await queue.add("failing-job", { attempt: 1 });

  await new Promise<void>(resolve => {
    const checkRetry = () => {
      if (jobCount >= 2) {
        resolve();
      } else {
        setTimeout(checkRetry, 20);
      }
    };
    setTimeout(checkRetry, 50);
  });

  expect(jobCount).toBeGreaterThanOrEqual(2);
  expect(lastJob.id).toBe(jobId);
});

test("Bun.Queue multiple jobs in sequence", async () => {
  const queue = new Bun.Queue("test-queue");
  const processedJobs: any[] = [];

  queue.worker(async job => {
    processedJobs.push({
      id: job.id,
      name: job.name,
      data: job.data,
    });
  });

  const jobIds = [];
  for (let i = 0; i < 3; i++) {
    const jobId = await queue.add(`job-${i}`, { index: i });
    jobIds.push(jobId);
  }

  await new Promise<void>(resolve => {
    const checkProcessing = () => {
      if (processedJobs.length >= 3) {
        resolve();
      } else {
        setTimeout(checkProcessing, 10);
      }
    };
    setTimeout(checkProcessing, 50);
  });

  expect(processedJobs).toHaveLength(3);
  for (let i = 0; i < 3; i++) {
    const processed = processedJobs.find(job => job.name === `job-${i}`);
    expect(processed).toBeDefined();
    expect(processed.data.index).toBe(i);
    expect(jobIds).toContain(processed.id);
  }
});

test("Bun.Queue with async worker", async () => {
  const queue = new Bun.Queue("async-queue");
  let processedJob: any = null;

  queue.worker(async job => {
    await new Promise(resolve => setTimeout(resolve, 10));
    processedJob = job;
  });

  const jobId = await queue.add("async-job", { async: true });

  await new Promise<void>(resolve => {
    const checkProcessing = () => {
      if (processedJob) {
        resolve();
      } else {
        setTimeout(checkProcessing, 5);
      }
    };
    setTimeout(checkProcessing, 30);
  });

  expect(processedJob).toBeDefined();
  expect(processedJob.id).toBe(jobId);
  expect(processedJob.data.async).toBe(true);
});

test("Bun.Queue serialization of complex data", async () => {
  const queue = new Bun.Queue("data-queue");
  let processedData: any = null;

  queue.worker(async job => {
    processedData = job.data;
  });

  const complexData = {
    string: "hello",
    number: 42,
    boolean: true,
    null: null,
    array: [1, 2, 3],
    nested: {
      prop: "value",
    },
  };

  await queue.add("complex-job", complexData);

  await new Promise<void>(resolve => {
    const checkProcessing = () => {
      if (processedData) {
        resolve();
      } else {
        setTimeout(checkProcessing, 10);
      }
    };
    setTimeout(checkProcessing, 30);
  });

  expect(processedData).toEqual(complexData);
});
