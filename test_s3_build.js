// Test script for S3 build functionality
import { $ } from "bun";

// Create a simple test file
await Bun.write(
  "test_app.js",
  `
console.log("Hello from S3 build test!");
export default { message: "This is a test build" };
`,
);

// Test 1: Basic S3 URL support
console.log("Test 1: Building with S3 URL...");
try {
  const result = await Bun.build({
    entrypoints: ["./test_app.js"],
    outdir: "./out",
    s3: "s3://my-bucket/builds/test",
  });

  console.log("Build result:", result);
  console.log("Success:", result.success);
  console.log("Outputs:", result.outputs?.length || 0);
} catch (error) {
  console.error("Error:", error.message);
}

// Test 2: S3 with credentials object
console.log("\nTest 2: Building with S3 credentials object...");
try {
  const result = await Bun.build({
    entrypoints: ["./test_app.js"],
    outdir: "./out",
    s3: {
      url: "s3://my-bucket/builds/test2",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      region: "us-west-2",
    },
  });

  console.log("Build result:", result);
  console.log("Success:", result.success);
  console.log("Outputs:", result.outputs?.length || 0);
} catch (error) {
  console.error("Error:", error.message);
}

// Clean up
await $`rm -f test_app.js`;
await $`rm -rf out`;
