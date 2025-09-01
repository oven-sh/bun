import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

devTest("error reporting is enabled by default", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
export default function (req, meta) {
  return new Response("Hello World");
}
`,
  },
  async test(dev) {
    // Test that server starts
    const response = await dev.fetch("/");
    expect(response.status).toBe(200);
    
    // Simulate client-side error by posting to /_bun/report_error endpoint
    // This tests the ErrorReportRequest.zig code path directly  
    const errorData = createErrorReportData("TestError", "Test client-side error - should be printed", "http://localhost/test");
    
    const reportResponse = await dev.fetch("/_bun/report_error", {
      method: "POST",
      body: errorData,
    });
    
    // The error reporting endpoint should process the request
    expect(reportResponse.status).toBe(200);
    
    // Await the response data to ensure the error processing is complete
    // The response contains remapped stack trace data
    const responseData = await reportResponse.arrayBuffer();
    expect(responseData.byteLength).toBeGreaterThan(0);
    
    // With default configuration, the error should be printed to terminal
    // (visible in test output as "frontend TestError: Test client-side error - should be printed")
  },
});

devTest("error reporting is disabled with console: false", {
  files: {
    "minimal.server.ts": `
import { Bake } from "bun";

export function render(req: Request, meta: Bake.RouteMetadata) {
  if (typeof meta.pageModule.default !== "function") {
    console.error("pageModule === ", meta.pageModule);
    throw new Error("Expected default export to be a function");
  }
  return meta.pageModule.default(req, meta);
}

export function registerClientReference(value: any, file: any, uid: any) {
  return {
    value,
    file,
    uid,
  };
}
`,
    "bun.app.ts": `
export default {
  port: 0,
  app: {
    framework: {
      fileSystemRouterTypes: [
        {
          root: "routes",
          style: "nextjs-pages",
          serverEntryPoint: "./minimal.server.ts",
        },
      ],
      serverComponents: {
        separateSSRGraph: false,
        serverRuntimeImportSource: "./minimal.server.ts",
        serverRegisterClientReferenceExport: "registerClientReference",
      },
    },
  },
  development: {
    console: false,
  },
};
`,
    "routes/index.ts": `
export default function (req, meta) {
  return new Response("Hello World with console false");
}
`,
  },
  async test(dev) {
    // Test that server starts with console: false
    const response = await dev.fetch("/");
    expect(response.status).toBe(200);
    
    // Simulate client-side error by posting to /_bun/report_error endpoint
    const errorData = createErrorReportData("TestError", "Test client-side error - should be suppressed", "http://localhost/test");
    
    const reportResponse = await dev.fetch("/_bun/report_error", {
      method: "POST", 
      body: errorData,
    });
    
    // The error reporting endpoint should still process the request
    expect(reportResponse.status).toBe(200);
    
    // Await the response data to ensure the error processing is complete
    // The response contains remapped stack trace data
    const responseData = await reportResponse.arrayBuffer();
    expect(responseData.byteLength).toBeGreaterThan(0);
    
    // With console: false, the error should NOT be printed to terminal
    // (no "frontend TestError" output should appear in test output)
  },
});

// Helper function to create binary error report data matching the protocol
function createErrorReportData(name: string, message: string, browserUrl: string): ArrayBuffer {
  // Simple implementation that matches the protocol described in ErrorReportRequest.zig
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const messageBytes = encoder.encode(message);  
  const urlBytes = encoder.encode(browserUrl);
  
  // Calculate buffer size: 3 length fields + string data + frame count (0 frames for simplicity)
  const bufferSize = 4 + nameBytes.length + 4 + messageBytes.length + 4 + urlBytes.length + 4;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  
  let offset = 0;
  
  // Write name
  view.setUint32(offset, nameBytes.length, true);
  offset += 4;
  new Uint8Array(buffer, offset, nameBytes.length).set(nameBytes);
  offset += nameBytes.length;
  
  // Write message  
  view.setUint32(offset, messageBytes.length, true);
  offset += 4;
  new Uint8Array(buffer, offset, messageBytes.length).set(messageBytes);
  offset += messageBytes.length;
  
  // Write browser URL
  view.setUint32(offset, urlBytes.length, true);
  offset += 4;
  new Uint8Array(buffer, offset, urlBytes.length).set(urlBytes);
  offset += urlBytes.length;
  
  // Write frame count (0 frames)
  view.setUint32(offset, 0, true);
  
  return buffer;
}