const { spawn } = await import("child_process");
const assert = await import("assert");
const http = await import("http");

async function runTest() {
  return new Promise((resolve, reject) => {
    const server = spawn("node", ["04298.fixture.js"], {
      cwd: import.meta.dirname,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    server.on("message", url => {
      http
        .get(url, res => {
          assert.strictEqual(res.statusCode, 500);
          server.kill();
          resolve();
        })
        .on("error", reject);
    });

    server.on("error", reject);
    server.on("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited with code ${code}`));
      } else if (signal) {
        reject(new Error(`Server was killed with signal ${signal}`));
      }
    });
  });
}

runTest()
  .then(() => {
    console.log("Test passed");
    process.exit(0);
  })
  .catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
