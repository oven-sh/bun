import { test, expect } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

test("issue #18737 - WebSocket connection and malformed HTTP response with Nuxt DevTools", async () => {
  // Test case 1: Malformed HTTP response handling
  const serverCode = `
const server = Bun.serve({
  port: 0,
  fetch(req) {
    // Simulate malformed HTTP response by returning invalid headers
    const url = new URL(req.url);
    if (url.pathname === '/malformed') {
      // This should trigger proper error handling without crashing
      return new Response("", {
        status: 200,
        headers: {
          "Invalid-Header": "\\r\\n\\r\\nmalformed\\r\\n"
        }
      });
    }
    if (url.pathname === '/websocket') {
      // Test WebSocket upgrade path
      if (server.upgrade(req, {
        data: { test: true }
      })) {
        return;
      }
      return new Response("Upgrade failed", { status: 400 });
    }
    return new Response("OK");
  },
  websocket: {
    open(ws) {
      ws.send("connection established");
    },
    message(ws, message) {
      ws.send("echo: " + message);
    },
    close(ws) {
      console.log("WebSocket closed");
    }
  }
});

console.log(JSON.stringify({
  port: server.port,
  url: server.url.toString()
}));

// Keep server alive for tests
await new Promise(resolve => setTimeout(resolve, 5000));
server.stop();
`;

  const clientCode = `
const serverInfo = JSON.parse(process.argv[2]);

// Test 1: Handle malformed HTTP response gracefully
try {
  const response = await fetch(serverInfo.url + '/malformed');
  console.log("Malformed response test passed");
} catch (error) {
  if (error.code === 'Malformed_HTTP_Response') {
    console.log("Malformed_HTTP_Response error handled correctly");
  } else {
    console.error("Unexpected error:", error);
    process.exit(1);
  }
}

// Test 2: WebSocket connection should work properly
try {
  const ws = new WebSocket(serverInfo.url.replace('http', 'ws') + '/websocket');
  
  await new Promise((resolve, reject) => {
    let messageReceived = false;
    
    ws.onopen = () => {
      console.log("WebSocket connected successfully");
      ws.send("test message");
    };
    
    ws.onmessage = (event) => {
      if (!messageReceived) {
        console.log("WebSocket message received:", event.data);
        messageReceived = true;
        ws.close();
        resolve(undefined);
      }
    };
    
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      reject(error);
    };
    
    ws.onclose = () => {
      if (messageReceived) {
        console.log("WebSocket closed properly");
      }
    };
    
    // Timeout after 3 seconds
    setTimeout(() => {
      if (!messageReceived) {
        reject(new Error("WebSocket test timeout"));
      }
    }, 3000);
  });
  
  console.log("WebSocket test passed");
} catch (error) {
  console.error("WebSocket test failed:", error);
  process.exit(1);
}

console.log("All tests passed");
`;

  const serverDir = tempDirWithFiles("websocket-test-server", {
    "server.js": serverCode,
  });
  
  const clientDir = tempDirWithFiles("websocket-test-client", {
    "client.js": clientCode,
  });

  // Start server
  const serverProc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: serverDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  let serverInfo: { port: number; url: string };
  try {
    const serverOutput = await serverProc.stdout.text();
    const lines = serverOutput.trim().split('\n');
    serverInfo = JSON.parse(lines[0]);
  } catch (error) {
    const stderr = await serverProc.stderr.text();
    throw new Error(`Server failed to start: ${error}\nstderr: ${stderr}`);
  }

  // Run client tests
  const clientProc = Bun.spawn({
    cmd: [bunExe(), "client.js", JSON.stringify(serverInfo)],
    cwd: clientDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [clientStdout, clientStderr, clientExitCode] = await Promise.all([
    clientProc.stdout.text(),
    clientProc.stderr.text(),
    clientProc.exited,
  ]);

  serverProc.kill();

  if (clientExitCode !== 0) {
    console.error("Client stdout:", clientStdout);
    console.error("Client stderr:", clientStderr);
    throw new Error(`Client tests failed with exit code ${clientExitCode}`);
  }

  expect(clientStdout).toContain("WebSocket test passed");
  expect(clientStdout).toContain("All tests passed");
});

// Test for specific Nuxt DevTools scenario
test("issue #18737 - Nuxt DevTools WebSocket HMR simulation", async () => {
  const devServerCode = `
// Simulate Nuxt DevTools server behavior
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    
    // DevTools WebSocket upgrade endpoint
    if (url.pathname === '/__nuxt_devtools__/client') {
      if (server.upgrade(req, {
        data: { 
          type: 'devtools',
          id: Math.random().toString(36)
        }
      })) {
        return;
      }
      return new Response("DevTools upgrade failed", { status: 400 });
    }
    
    // HMR WebSocket endpoint
    if (url.pathname === '/_nuxt/hmr') {
      if (server.upgrade(req, {
        data: { 
          type: 'hmr',
          id: Math.random().toString(36)
        }
      })) {
        return;
      }
      return new Response("HMR upgrade failed", { status: 400 });
    }
    
    // Regular HTTP responses that might be malformed
    if (url.pathname === '/_nuxt/dev-server-info') {
      return new Response(JSON.stringify({
        version: "3.16.2",
        devtools: true
      }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        }
      });
    }
    
    return new Response("Nuxt Dev Server");
  },
  websocket: {
    open(ws, req) {
      const data = req.data;
      console.log("WebSocket opened:", data.type);
      
      if (data.type === 'devtools') {
        ws.send(JSON.stringify({
          type: 'connected',
          payload: { status: 'ready' }
        }));
      } else if (data.type === 'hmr') {
        ws.send(JSON.stringify({
          type: 'connected'
        }));
        
        // Simulate HMR update
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'update',
            updates: [{
              type: 'js-update',
              path: '/pages/index.vue',
              timestamp: Date.now()
            }]
          }));
        }, 100);
      }
    },
    message(ws, message, req) {
      const data = req.data;
      console.log("WebSocket message:", data.type, message);
      
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        // Handle non-JSON messages
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid message format' 
        }));
      }
    },
    close(ws, code, message, req) {
      console.log("WebSocket closed:", req.data.type, code);
    }
  }
});

console.log(JSON.stringify({
  port: server.port,
  url: server.url.toString()
}));

// Keep server alive
await new Promise(resolve => setTimeout(resolve, 5000));
server.stop();
`;

  const devClientCode = `
const serverInfo = JSON.parse(process.argv[2]);

let testsCompleted = 0;
const totalTests = 2;

function completeTest() {
  testsCompleted++;
  if (testsCompleted === totalTests) {
    console.log("All DevTools tests passed");
    process.exit(0);
  }
}

// Test DevTools WebSocket connection
const devtoolsWs = new WebSocket(serverInfo.url.replace('http', 'ws') + '/__nuxt_devtools__/client');

devtoolsWs.onopen = () => {
  console.log("DevTools WebSocket connected");
  devtoolsWs.send(JSON.stringify({ type: 'ping' }));
};

devtoolsWs.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("DevTools message:", data.type);
  if (data.type === 'pong') {
    console.log("DevTools test passed");
    devtoolsWs.close();
    completeTest();
  }
};

devtoolsWs.onerror = (error) => {
  console.error("DevTools WebSocket error:", error);
  process.exit(1);
};

// Test HMR WebSocket connection
const hmrWs = new WebSocket(serverInfo.url.replace('http', 'ws') + '/_nuxt/hmr');

hmrWs.onopen = () => {
  console.log("HMR WebSocket connected");
};

hmrWs.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("HMR message:", data.type);
  if (data.type === 'update') {
    console.log("HMR test passed");
    hmrWs.close();
    completeTest();
  }
};

hmrWs.onerror = (error) => {
  console.error("HMR WebSocket error:", error);
  process.exit(1);
};

// Test regular HTTP endpoints
try {
  const response = await fetch(serverInfo.url + '/_nuxt/dev-server-info');
  const info = await response.json();
  console.log("Dev server info retrieved:", info.version);
} catch (error) {
  console.error("HTTP request failed:", error);
  process.exit(1);
}

// Timeout for tests
setTimeout(() => {
  if (testsCompleted < totalTests) {
    console.error("Tests timeout - completed:", testsCompleted, "of", totalTests);
    process.exit(1);
  }
}, 4000);
`;

  const devServerDir = tempDirWithFiles("nuxt-dev-server", {
    "server.js": devServerCode,
  });
  
  const devClientDir = tempDirWithFiles("nuxt-dev-client", {
    "client.js": devClientCode,
  });

  // Start dev server
  const devServerProc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: devServerDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  let devServerInfo: { port: number; url: string };
  try {
    const serverOutput = await devServerProc.stdout.text();
    const lines = serverOutput.trim().split('\n');
    devServerInfo = JSON.parse(lines[0]);
  } catch (error) {
    const stderr = await devServerProc.stderr.text();
    throw new Error(`Dev server failed to start: ${error}\nstderr: ${stderr}`);
  }

  // Run dev client tests
  const devClientProc = Bun.spawn({
    cmd: [bunExe(), "client.js", JSON.stringify(devServerInfo)],
    cwd: devClientDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [devClientStdout, devClientStderr, devClientExitCode] = await Promise.all([
    devClientProc.stdout.text(),
    devClientProc.stderr.text(),
    devClientProc.exited,
  ]);

  devServerProc.kill();

  if (devClientExitCode !== 0) {
    console.error("Dev client stdout:", devClientStdout);
    console.error("Dev client stderr:", devClientStderr);
    throw new Error(`Dev client tests failed with exit code ${devClientExitCode}`);
  }

  expect(devClientStdout).toContain("All DevTools tests passed");
});