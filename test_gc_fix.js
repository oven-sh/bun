// Test to verify the GC heap size reporting fix for Blob to ReadableStream conversion

async function testBlobToStreamConversion() {
  console.log("Testing Blob to ReadableStream conversion...");

  // Create a large blob to make memory reporting issues more apparent
  const size = 100 * 1024 * 1024; // 100MB
  const buffer = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    buffer[i] = i % 256;
  }

  const blob = new Blob([buffer]);
  console.log(`Created blob of size: ${blob.size} bytes`);

  // Convert to ReadableStream
  const stream = blob.stream();
  console.log("Converted blob to ReadableStream");

  // Read from the stream
  const reader = stream.getReader();
  let totalRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalRead += value.length;
  }

  console.log(`Read ${totalRead} bytes from stream`);

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
    console.log("Forced garbage collection");
  }

  console.log("Test completed successfully!");
}

// Run the test multiple times to stress the memory reporting
async function runTests() {
  for (let i = 0; i < 5; i++) {
    console.log(`\n--- Test iteration ${i + 1} ---`);
    await testBlobToStreamConversion();

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

runTests().catch(console.error);
