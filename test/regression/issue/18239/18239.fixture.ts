// Test script for TTY stdin buffering issue
// Should work the same in Node.js and Bun

console.log("Starting TTY stdin test...");
console.log("Listening for chunks from stdin...");

let chunkCount = 0;

for await (const chunk of process.stdin) {
  chunkCount++;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Chunk #${chunkCount}:`, chunk);

  // If we get more than 3 chunks, exit
  if (chunkCount >= 3) {
    console.log("Received 3 chunks, exiting...");
    process.exit(0);
  }
}

console.error("Exited without receiving 3 chunks");
process.exit(1);
