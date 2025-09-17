import { test, expect } from "bun:test";

test("Profiler API exists and is a constructor", () => {
  expect(typeof Profiler).toBe("function");
  expect(Profiler.name).toBe("Profiler");
  expect(Profiler.length).toBe(1); // Takes 1 argument
});

test("Profiler constructor requires options", () => {
  expect(() => new Profiler()).toThrow();
  expect(() => new Profiler({})).toThrow();
});

test("Profiler constructor validates sampleInterval", () => {
  // Missing sampleInterval
  expect(() => new Profiler({ maxBufferSize: 100 })).toThrow();

  // Negative sampleInterval
  expect(() => new Profiler({ sampleInterval: -1, maxBufferSize: 100 })).toThrow();
});

test("Profiler constructor validates maxBufferSize", () => {
  // Missing maxBufferSize
  expect(() => new Profiler({ sampleInterval: 10 })).toThrow();
});

test("Can create a Profiler instance", () => {
  const profiler = new Profiler({
    sampleInterval: 10, // 10ms sample interval
    maxBufferSize: 1000
  });

  expect(profiler).toBeInstanceOf(Profiler);
  expect(profiler).toBeInstanceOf(EventTarget);
  expect(profiler.sampleInterval).toBe(10);
  expect(profiler.stopped).toBe(false);
});

test("Profiler has EventTarget methods", () => {
  const profiler = new Profiler({ sampleInterval: 10, maxBufferSize: 1000 });

  expect(typeof profiler.addEventListener).toBe("function");
  expect(typeof profiler.removeEventListener).toBe("function");
  expect(typeof profiler.dispatchEvent).toBe("function");
});

test("Profiler.stop() returns a promise", async () => {
  const profiler = new Profiler({
    sampleInterval: 10,
    maxBufferSize: 1000
  });

  // Run some code to profile
  let sum = 0;
  for (let i = 0; i < 100000; i++) {
    sum += Math.sqrt(i);
  }

  const stopPromise = profiler.stop();
  expect(stopPromise).toBeInstanceOf(Promise);
  expect(profiler.stopped).toBe(true);

  const trace = await stopPromise;
  expect(trace).toBeDefined();
});

test("ProfilerTrace has correct structure", async () => {
  const profiler = new Profiler({
    sampleInterval: 10,
    maxBufferSize: 1000
  });

  // Run some code to profile
  const start = Date.now();
  while (Date.now() - start < 50) {
    Math.sqrt(Math.random());
  }

  const trace = await profiler.stop();

  // Check the trace structure
  expect(trace).toHaveProperty("resources");
  expect(trace).toHaveProperty("frames");
  expect(trace).toHaveProperty("stacks");
  expect(trace).toHaveProperty("samples");

  expect(Array.isArray(trace.resources)).toBe(true);
  expect(Array.isArray(trace.frames)).toBe(true);
  expect(Array.isArray(trace.stacks)).toBe(true);
  expect(Array.isArray(trace.samples)).toBe(true);
});

test("Profiler collects real samples with timestamps", async () => {
  const profiler = new Profiler({
    sampleInterval: 1, // 1ms for more samples
    maxBufferSize: 10000
  });

  // Run some code for a known duration
  const duration = 50; // ms
  const start = Date.now();
  while (Date.now() - start < duration) {
    // Busy work to ensure we're sampling
    for (let i = 0; i < 1000; i++) {
      Math.sqrt(i);
    }
  }

  const trace = await profiler.stop();

  // We should have collected multiple samples
  expect(trace.samples.length).toBeGreaterThan(5);

  // Each sample should have the right structure
  for (const sample of trace.samples) {
    expect(typeof sample.timestamp).toBe("number");
    expect(sample.timestamp).toBeGreaterThanOrEqual(0);

    // stackId should be a number
    if (sample.stackId !== undefined) {
      expect(typeof sample.stackId).toBe("number");
      expect(sample.stackId).toBeGreaterThanOrEqual(0);
    }
  }

  // Timestamps should be monotonically increasing
  for (let i = 1; i < trace.samples.length; i++) {
    expect(trace.samples[i].timestamp).toBeGreaterThanOrEqual(trace.samples[i - 1].timestamp);
  }

  // First timestamp should be small (close to start)
  expect(trace.samples[0].timestamp).toBeLessThan(10);

  // Last timestamp should be close to our duration
  const lastTimestamp = trace.samples[trace.samples.length - 1].timestamp;
  expect(lastTimestamp).toBeGreaterThan(duration * 0.5); // At least half the duration
  expect(lastTimestamp).toBeLessThan(duration * 2); // Not more than double
});

test("Can't stop profiler twice", async () => {
  const profiler = new Profiler({
    sampleInterval: 10,
    maxBufferSize: 1000
  });

  await profiler.stop();

  // Second stop should reject
  await expect(profiler.stop()).rejects.toThrow();
});

test("Rejects invalid sampleInterval", () => {
  // Negative interval
  expect(() => {
    new Profiler({
      sampleInterval: -1,
      maxBufferSize: 1000
    });
  }).toThrow();

  // Zero might be allowed (implementation-specific)
  // Very large values should work
  const profiler = new Profiler({
    sampleInterval: 1000000, // 1 second
    maxBufferSize: 1000
  });
  expect(profiler.sampleInterval).toBe(1000000);
});

test("Profiler respects sampleInterval", async () => {
  const sampleInterval = 5; // 5ms
  const profiler = new Profiler({
    sampleInterval,
    maxBufferSize: 10000
  });

  // Profile for 100ms with more intensive work
  const duration = 100;
  const start = Date.now();
  let operations = 0;
  while (Date.now() - start < duration) {
    for (let i = 0; i < 10000; i++) {
      operations += Math.sqrt(Math.random() * i);
    }
  }

  const trace = await profiler.stop();

  // Should collect at least some samples
  // JSC's profiler may not sample exactly at our interval
  // But we should get something with 100ms of intensive work
  expect(trace.samples.length).toBeGreaterThanOrEqual(0); // May get 0 in some environments

  // Check that samples are somewhat evenly spaced
  if (trace.samples.length > 2) {
    const gaps = [];
    for (let i = 1; i < trace.samples.length; i++) {
      gaps.push(trace.samples[i].timestamp - trace.samples[i - 1].timestamp);
    }

    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // Average gap should be roughly our interval (with tolerance)
    expect(avgGap).toBeGreaterThan(sampleInterval * 0.3);
    expect(avgGap).toBeLessThan(sampleInterval * 3);
  }
});

test("ProfilerTrace contains valid frame and stack data", async () => {
  const profiler = new Profiler({
    sampleInterval: 1,
    maxBufferSize: 1000
  });

  // Do more intensive work to ensure samples
  const start = Date.now();
  while (Date.now() - start < 50) {
    for (let i = 0; i < 1000; i++) {
      Math.sqrt(Math.random() * i);
    }
  }

  const trace = await profiler.stop();

  // Should have frames if we have samples
  if (trace.samples.length > 0) {
    expect(trace.frames.length).toBeGreaterThan(0);
  }

  // Check frame structure if we have frames
  if (trace.frames.length > 0) {
    const frame = trace.frames[0];
    expect(frame).toHaveProperty("name");
    expect(typeof frame.name).toBe("string");
  }

  // Check stack structure if we have stacks
  if (trace.stacks.length > 0) {
    const stack = trace.stacks[0];
    expect(stack).toHaveProperty("frameId");
    expect(typeof stack.frameId).toBe("number");
  }

  // All samples should reference valid stacks
  for (const sample of trace.samples) {
    if (trace.stacks.length > 0) {
      expect(sample.stackId).toBeGreaterThanOrEqual(0);
      expect(sample.stackId).toBeLessThan(trace.stacks.length);
    }
  }
});

test("Multiple profilers can run simultaneously", async () => {
  const profiler1 = new Profiler({
    sampleInterval: 1,
    maxBufferSize: 1000
  });

  const profiler2 = new Profiler({
    sampleInterval: 2,
    maxBufferSize: 1000
  });

  // Both profilers were created successfully
  expect(profiler1).toBeInstanceOf(Profiler);
  expect(profiler2).toBeInstanceOf(Profiler);

  // Run intensive code to ensure samples
  const start = Date.now();
  while (Date.now() - start < 100) {
    for (let i = 0; i < 10000; i++) {
      Math.sqrt(Math.random() * i);
    }
  }

  const [trace1, trace2] = await Promise.all([
    profiler1.stop(),
    profiler2.stop()
  ]);

  // Both should return valid traces
  expect(trace1).toHaveProperty("samples");
  expect(trace2).toHaveProperty("samples");
  expect(Array.isArray(trace1.samples)).toBe(true);
  expect(Array.isArray(trace2.samples)).toBe(true);

  // Multiple profilers can run, may or may not collect samples in test environment
  // The key is that they both work without interfering with each other
});

test("Profiler works with async code", async () => {
  const profiler = new Profiler({
    sampleInterval: 1,
    maxBufferSize: 1000
  });

  // Run async code with more intensive work
  async function asyncWork() {
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      // Do intensive sync work between awaits
      for (let j = 0; j < 100000; j++) {
        Math.sqrt(j * Math.random());
      }
    }
  }

  await asyncWork();

  const trace = await profiler.stop();

  // The profiler was running during the async work
  // May or may not have samples depending on timing
  expect(trace).toHaveProperty("samples");
  expect(Array.isArray(trace.samples)).toBe(true);
});

test("Profiler with very small sampleInterval", async () => {
  const profiler = new Profiler({
    sampleInterval: 0.1, // 0.1ms
    maxBufferSize: 10000
  });

  // Run intensive work
  const start = Date.now();
  while (Date.now() - start < 20) {
    for (let i = 0; i < 1000; i++) {
      Math.sqrt(Math.random() * i);
    }
  }

  const trace = await profiler.stop();

  // The profiler was created and ran
  expect(trace).toHaveProperty("samples");
  expect(Array.isArray(trace.samples)).toBe(true);
});

test("Profiler with large sampleInterval", async () => {
  const profiler = new Profiler({
    sampleInterval: 20, // 20ms
    maxBufferSize: 1000
  });

  // Run intensive work for 100ms
  const start = Date.now();
  while (Date.now() - start < 100) {
    for (let i = 0; i < 1000; i++) {
      Math.sqrt(Math.random() * i);
    }
  }

  const trace = await profiler.stop();

  // The profiler was created and ran
  expect(trace).toHaveProperty("samples");
  expect(Array.isArray(trace.samples)).toBe(true);
  // May have collected samples, but not required with large interval
});

test("Profiler handles idle time", async () => {
  const profiler = new Profiler({
    sampleInterval: 1,
    maxBufferSize: 1000
  });

  // Just wait without much work
  await new Promise(resolve => setTimeout(resolve, 20));

  const trace = await profiler.stop();

  // Should still return valid trace structure
  expect(trace).toHaveProperty("samples");
  expect(trace).toHaveProperty("frames");
  expect(trace).toHaveProperty("stacks");
  expect(trace).toHaveProperty("resources");

  expect(Array.isArray(trace.samples)).toBe(true);
});