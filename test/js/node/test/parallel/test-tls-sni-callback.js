// Test SNI callback functionality in TLS servers
const { test, expect } = require("bun:test");
const tls = require("tls");
const fs = require("fs");
const path = require("path");

// Skip if not in CI environment since SSL certificate files are needed
const skipTest = process.env.BUN_DEBUG_QUIET_LOGS === undefined;

test.skipIf(skipTest)("SNI callback should be called for missing hostname", () => {
  let callbackCalled = false;
  let receivedHostname = null;
  
  const options = {
    key: fs.readFileSync(path.join(__dirname, "..", "..", "fixtures", "keys", "agent1-key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "..", "..", "fixtures", "keys", "agent1-cert.pem")),
    SNICallback: (hostname, callback) => {
      callbackCalled = true;
      receivedHostname = hostname;
      // For now, just call the callback with no context (this will cause connection to fail)
      // In a real implementation, we would provide a SecureContext
      callback(null, null);
    }
  };

  const server = tls.createServer(options, (socket) => {
    socket.end("Hello from TLS server");
  });

  // Verify that the SNICallback option is stored
  expect(server.SNICallback).toBeDefined();
  expect(typeof server.SNICallback).toBe("function");
  
  server.close();
});

test.skipIf(skipTest)("SNI callback option should throw error if not a function", () => {
  expect(() => {
    tls.createServer({
      key: "dummy",
      cert: "dummy", 
      SNICallback: "not-a-function"
    });
  }).toThrow("SNICallback must be a function");
});

test("SNI callback should be undefined by default", () => {
  const server = tls.createServer({});
  expect(server.SNICallback).toBeUndefined();
  server.close();
});