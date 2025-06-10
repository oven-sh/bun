// Test multiple Blob <-> ReadableStream conversions to verify memory reporting

async function streamToBlob(stream) {
  const chunks = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return new Blob(chunks);
}

async function testRoundtrip() {
  console.log("Testing Blob <-> ReadableStream roundtrip conversions...");

  // Start with a moderately sized blob
  const initialSize = 10 * 1024 * 1024; // 10MB
  const initialData = new Uint8Array(initialSize);
  for (let i = 0; i < initialSize; i++) {
    initialData[i] = i % 256;
  }

  let blob = new Blob([initialData]);
  console.log(`Initial blob size: ${blob.size} bytes`);

  // Do multiple roundtrips
  for (let i = 0; i < 10; i++) {
    // Blob -> ReadableStream
    const stream = blob.stream();

    // ReadableStream -> Blob
    blob = await streamToBlob(stream);

    console.log(`Roundtrip ${i + 1}: blob size = ${blob.size} bytes`);

    if (blob.size !== initialSize) {
      throw new Error(`Size mismatch after roundtrip ${i + 1}: expected ${initialSize}, got ${blob.size}`);
    }
  }

  // Final verification by reading the data
  const finalStream = blob.stream();
  const reader = finalStream.getReader();
  let totalRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalRead += value.length;

    // Verify some data integrity
    if (value.length > 0 && value[0] !== 0) {
      console.log(`First byte of chunk: ${value[0]}`);
    }
  }

  console.log(`Final read: ${totalRead} bytes`);

  if (totalRead !== initialSize) {
    throw new Error(`Final size mismatch: expected ${initialSize}, got ${totalRead}`);
  }

  console.log("Roundtrip test completed successfully!");
}

// Also test with Bun.readableStreamToBlob if available
async function testBunApi() {
  if (!Bun?.readableStreamToBlob) {
    console.log("Bun.readableStreamToBlob not available, skipping");
    return;
  }

  console.log("\nTesting with Bun.readableStreamToBlob...");

  const size = 5 * 1024 * 1024; // 5MB
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = (i * 7) % 256;
  }

  const blob1 = new Blob([data]);
  const stream = blob1.stream();
  const blob2 = await Bun.readableStreamToBlob(stream);

  console.log(`Original blob size: ${blob1.size}`);
  console.log(`Result blob size: ${blob2.size}`);

  if (blob1.size !== blob2.size) {
    throw new Error(`Size mismatch: ${blob1.size} != ${blob2.size}`);
  }

  console.log("Bun API test completed successfully!");
}

async function runAllTests() {
  try {
    await testRoundtrip();
    await testBunApi();

    // Force GC if available
    if (global.gc) {
      global.gc();
      console.log("\nForced garbage collection");
    }

    console.log("\nAll tests passed!");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

runAllTests();
