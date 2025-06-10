import { test, expect } from "bun:test";

test("Blob to ReadableStream memory reporting", async () => {
  // Test 1: Basic Blob to stream conversion
  {
    const size = 10 * 1024 * 1024; // 10MB
    const data = new Uint8Array(size);
    const blob = new Blob([data]);

    // Convert to stream
    const stream = blob.stream();
    expect(stream).toBeDefined();

    // Read the stream
    const reader = stream.getReader();
    let totalRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalRead += value.length;
    }

    expect(totalRead).toBe(size);
  }

  // Test 2: Multiple streams from same Blob
  {
    const data = new Uint8Array(1024 * 1024); // 1MB
    const blob = new Blob([data]);

    // Create multiple streams
    const stream1 = blob.stream();
    const stream2 = blob.stream();

    // Read both streams
    const chunks1 = [];
    const chunks2 = [];

    const reader1 = stream1.getReader();
    const reader2 = stream2.getReader();

    // Read stream1
    while (true) {
      const { done, value } = await reader1.read();
      if (done) break;
      chunks1.push(value);
    }

    // Read stream2
    while (true) {
      const { done, value } = await reader2.read();
      if (done) break;
      chunks2.push(value);
    }

    const total1 = chunks1.reduce((sum, chunk) => sum + chunk.length, 0);
    const total2 = chunks2.reduce((sum, chunk) => sum + chunk.length, 0);

    expect(total1).toBe(data.length);
    expect(total2).toBe(data.length);
  }

  // Test 3: Blob -> Stream -> Blob roundtrip
  {
    const originalData = new Uint8Array(5 * 1024 * 1024); // 5MB
    for (let i = 0; i < originalData.length; i++) {
      originalData[i] = i % 256;
    }

    const blob1 = new Blob([originalData]);
    const stream = blob1.stream();

    // Use Bun.readableStreamToBlob if available
    let blob2;
    if (typeof Bun !== "undefined" && Bun.readableStreamToBlob) {
      blob2 = await Bun.readableStreamToBlob(stream);
    } else {
      // Manual conversion
      const chunks = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      blob2 = new Blob(chunks);
    }

    expect(blob2.size).toBe(blob1.size);

    // Verify content
    const arrayBuffer = await blob2.arrayBuffer();
    const resultData = new Uint8Array(arrayBuffer);
    expect(resultData.length).toBe(originalData.length);
    expect(resultData[0]).toBe(originalData[0]);
    expect(resultData[resultData.length - 1]).toBe(originalData[originalData.length - 1]);
  }

  // Test 4: File-backed Blob (if supported)
  if (typeof Bun !== "undefined" && Bun.file) {
    const file = Bun.file("test_blob_stream_file.tmp");

    // Write test data
    const testData = new Uint8Array(1024);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = (i * 7) % 256;
    }
    await Bun.write(file, testData);

    // Read as stream
    const stream = file.stream();
    const chunks = [];
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalRead = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(totalRead).toBe(testData.length);

    // Cleanup
    try {
      await Bun.unlink("test_blob_stream_file.tmp");
    } catch {}
  }

  // Test 5: Empty Blob
  {
    const emptyBlob = new Blob([]);
    const stream = emptyBlob.stream();
    const reader = stream.getReader();

    const { done, value } = await reader.read();
    expect(done).toBe(true);
    expect(value).toBeUndefined();
  }

  // Test 6: Large number of small blobs (stress test)
  {
    const blobs = [];
    const streams = [];

    // Create 100 small blobs
    for (let i = 0; i < 100; i++) {
      const data = new Uint8Array(1024); // 1KB each
      data.fill(i % 256);
      const blob = new Blob([data]);
      blobs.push(blob);
      streams.push(blob.stream());
    }

    // Read all streams
    let totalBytesRead = 0;
    for (const stream of streams) {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytesRead += value.length;
      }
    }

    expect(totalBytesRead).toBe(100 * 1024);
  }
});

test("Blob to ReadableStream doesn't cause memory reporting issues", async () => {
  // This test creates scenarios that previously caused integer overflow

  // Force garbage collection if available
  const gc = global.gc || (() => {});

  // Create and consume many blob streams
  for (let iteration = 0; iteration < 5; iteration++) {
    const blobs = [];

    // Create several large blobs
    for (let i = 0; i < 10; i++) {
      const size = 10 * 1024 * 1024; // 10MB each
      const data = new Uint8Array(size);
      blobs.push(new Blob([data]));
    }

    // Convert all to streams and read them
    for (const blob of blobs) {
      const stream = blob.stream();
      const reader = stream.getReader();

      // Read and discard
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    // Force GC between iterations
    gc();

    // Small delay to let GC run
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  // If we get here without crashing, the test passes
  expect(true).toBe(true);
});
