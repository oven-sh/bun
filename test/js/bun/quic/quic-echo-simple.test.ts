import { test, expect } from "bun:test";

// Self-signed test certificate
const tls = {
  cert: `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUKQo6H7NMy8oNQ5Vl2MHFqG2E/IUwDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCVVMxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yMzEwMTExNDIzMTFaFw0yNDEw
MTAxNDIzMTFaMEUxCzAJBgNVBAYTAlVTMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCivPFcj1pI6b5r+IG8nMR7z8syQttD3bPYQh3lo4HH
cYU5bR2+zYnF5VIB8+J+qB3UG7NZaEPTERKk9ni+WaBdxLvbD4WLQE6wCvqFqmrY
CbbRGUlFgKb8V+RG8Pf4Z6ruq4Q7DzW7Wlm3nqElH6Xx9UwkBKvDEcj5gEwqxVME
t0ThpwVaPdxlqMQzFIJXkAqnKqCr+nwzt6n6RJ9TE8X8v5iQq6lU8/MnkTJzp/vh
bYiY0vRz3P/tiNqQyFCRyrvMRX9jOWDCvJQQe3RJbVvTLVmWOQxYVptUqMhKcGST
B3xA/HPQB3HTFhYTQsKJB9BvrvDr6MhWB0gQlu5mqYmhAgMBAAGjUzBRMB0GA1Ud
DgQWBBSYMOwQxT7Qp5Y8RcnD5LnV3OJQ8jAfBgNVHSMEGDAWgBSYMOwQxT7Qp5Y8
RcnD5LnV3OJQ8jAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBr
RomKvd9RPawTvL0+PpJJEH0sN3hZ7qm5GgUL1FWYAiCsuGtPcrd2u3qlISQKMNnJ
MEh+v5Gn6wpANQNbRltGCf6fL0i6j23wWFfEfE9zbMgpUspvD0ktRrZG8nPxTrCr
9vo5TEqNUzsWvlUoVJ5e1np6ODBcwOEh8BNwmI9T7vLKGY7QzVKnBJMogWGTwgLV
8zeUNUMWP5q8ySXjUGHSqWwIoWqs5hZgjfKCvdEpY6zNATlTCPKXCMFL+farOhSC
HQvSJhPsKdmPBuVOl5i2O2nJzBvdQJn0Ve8O9xqDlTd0J5G5FGLDXpJFXbqBBCU0
NJWNEh/lrqEOMIc/gyY2
-----END CERTIFICATE-----`,
  key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCivPFcj1pI6b5r
+IG8nMR7z8syQttD3bPYQh3lo4HHcYU5bR2+zYnF5VIB8+J+qB3UG7NZaEPTERKk
9ni+WaBdxLvbD4WLQE6wCvqFqmrYCbbRGUlFgKb8V+RG8Pf4Z6ruq4Q7DzW7Wlm3
nqElH6Xx9UwkBKvDEcj5gEwqxVMEt0ThpwVaPdxlqMQzFIJXkAqnKqCr+nwzt6n6
RJ9TE8X8v5iQq6lU8/MnkTJzp/vhbYiY0vRz3P/tiNqQyFCRyrvMRX9jOWDCvJQQ
e3RJbVvTLVmWOQxYVptUqMhKcGST B3xA/HPQB3HTFhYTQsKJB9BvrvDr6MhWB0gQ
lu5mqYmhAgMBAAECggEAGphLdXW6fP1MuLsvBGN/A6ii2sYWTWlX0rUl5+SfVXHH
dAUA9D/9J/fNy8DZAXvhh5Wi9Ws4L1DJff+H0otpN8Oz5fFKgIyPQ1k7vmIC0kWy
FvAT3qvXbk0SimqMfrO+XxB8xLdx5jwHLzByFJmKuMVzCz/gAXHIYhLvI9jDz7eb
JcPEkoJCQgvKT+wHCQNs65JNPGUDcp5rJLqXDLX0WMia0FflJpD9bT5zxLTQ+I2V
YJCPkxxDTgFvfkqWzlbWJKVTApOhvFZ2yOdMiQvvxQpdGHm0RPC2fwJNndle4yeX
EQuxQ6g2zp3A0ExYJeHaDPJRoXTJLzUiAWvABkkVsQKBgQDQy+7V6X+XlHUIaerA
f0xjJJFRBdmXHvAioplKKrfuPFNbQCz3uhVZGTNm/mPFGmozTLYdD8L4dJ6rsFLw
Cg7xbona3YnBZQUeyZjBQUdfevbhDJNb/P/EdhAjgh2zf4vw3CXQG1SMNLdsUfyf
8g0aKUgQXq/OBVY6tuPUqWEH2wKBgQDHjQCUSaVIj/NIjqJY9Xh8WYy2sMZNCxQd
VdSGPi4SvJEz4bNMLN0aVbVhmNmh1TQqEUOIJeTVJHVFIg3Hfidqn6FpXLFvS8aH
JU6c/yd7SJw8qPKOVdJNT+nGzaWvaiHTJE7bXs3TNlOqRA4zjVzYu5tcOLMPMOfD
oUGVEHRiowKBgQDI1rZSiFTLSJhQ2H+VENGr1vcEXMPPCKeMrTH7L9sB6FQkJBJb
2eMyMlYOS5VULXYCIZCJpcaFG9MGyR1x8bvTLNs2uu6Jb0CEG4qZHkhqaGwGhcBW
E1LOstfxNfPDhF/qCPNDMxO/Wy3gH7wrrhCCMaH6Y8aGLcHOcVOxHUVGNQKBgDcp
Z6KLuKQ5+LpsfeRsqmKphKZIrWOeYR1rVNqUXwxr8pFGKuXYH8qz3hKKeN0j+taI
y4IAG7JYEPBbLPM1/Nv+0j8YjLdOBvEONDfIRWsXJLVm4SFlCOpNhQfxrzcy1WNq
JlPLx5fXSS/BWZVQAJJNfGOJGC8SUHMqp6gETJHHAoGBAMSXpxLLOoU2AzJq9IK7
bAy1jCm3Hs8wNQjL6MmGZHTTzAbn9ThWui+vWBIDQc7pA8xJmGAqaRKZBtO4I/vC
8Xpv3bPqLhrrEYVdg49qBNxtaGPawQ/5koZu6q5L7TQVPq4melF0o+w0JAJfnVOs
dqHL6ltE1+8AFcHS2w0MR6aP
-----END PRIVATE KEY-----`
};

test("QUIC simple echo - debug stream flow", async () => {
  console.log("\n=== Starting QUIC Echo Test ===\n");
  
  let serverStreamCount = 0;
  let clientStreamCount = 0;
  let serverReceived = "";
  let clientReceived = "";
  
  // Create server
  console.log("Creating QUIC server...");
  const server = Bun.quic({
    hostname: "localhost",
    port: 0,
    server: true,
    tls: {
      cert: tls.cert,
      key: tls.key,
    },
    
    // Connection-level callbacks
    socketOpen(socket) {
      console.log("SERVER: Socket opened");
    },
    
    connection(socket) {
      console.log("SERVER: New client connected");
    },
    
    // Stream-level callbacks
    open(stream) {
      serverStreamCount++;
      console.log(`SERVER: Stream opened (id: ${stream.id}, total: ${serverStreamCount})`);
      console.log(`SERVER: Stream.data = ${JSON.stringify(stream.data)}`);
    },
    
    data(stream, buffer) {
      serverReceived = buffer.toString();
      console.log(`SERVER: Received on stream ${stream.id}: "${serverReceived}"`);
      
      // Echo back
      const response = `Echo: ${serverReceived}`;
      console.log(`SERVER: Writing response: "${response}"`);
      const written = stream.write(Buffer.from(response));
      console.log(`SERVER: Wrote ${written} bytes`);
    },
    
    close(stream) {
      console.log(`SERVER: Stream ${stream.id} closed`);
    },
    
    error(stream, err) {
      console.log(`SERVER: Stream ${stream.id} error:`, err);
    },
    
    drain(stream) {
      console.log(`SERVER: Stream ${stream.id} writable again`);
    },
  });
  
  const port = server.port;
  console.log(`Server listening on port ${port}\n`);
  
  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Create client
  console.log("Creating QUIC client...");
  const client = await Bun.quic({
    hostname: "localhost",
    port: port,
    server: false,
    tls: {
      cert: tls.cert,
      key: tls.key,
    },
    
    // Connection-level callbacks
    socketOpen(socket) {
      console.log("CLIENT: Socket opened, creating stream...");
      
      // Create a stream with metadata
      const stream = socket.stream({ type: "test", id: 1 });
      console.log(`CLIENT: Created stream (id: ${stream?.id})`);
      
      if (stream) {
        const message = "Hello QUIC!";
        console.log(`CLIENT: Writing "${message}" to stream...`);
        const written = stream.write(Buffer.from(message));
        console.log(`CLIENT: Wrote ${written} bytes`);
      } else {
        console.log("CLIENT: ERROR - stream is null!");
      }
    },
    
    // Stream-level callbacks
    open(stream) {
      clientStreamCount++;
      console.log(`CLIENT: Stream opened (id: ${stream.id}, total: ${clientStreamCount})`);
      console.log(`CLIENT: Stream.data = ${JSON.stringify(stream.data)}`);
    },
    
    data(stream, buffer) {
      clientReceived = buffer.toString();
      console.log(`CLIENT: Received on stream ${stream.id}: "${clientReceived}"`);
    },
    
    close(stream) {
      console.log(`CLIENT: Stream ${stream.id} closed`);
    },
    
    error(stream, err) {
      console.log(`CLIENT: Stream ${stream.id} error:`, err);
    },
    
    drain(stream) {
      console.log(`CLIENT: Stream ${stream.id} writable again`);
    },
  });
  
  console.log("\nWaiting for data exchange...\n");
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log("\n=== Test Results ===");
  console.log(`Server streams created: ${serverStreamCount}`);
  console.log(`Client streams created: ${clientStreamCount}`);
  console.log(`Server received: "${serverReceived}"`);
  console.log(`Client received: "${clientReceived}"`);
  
  // Verify data was exchanged
  expect(serverReceived).toBe("Hello QUIC!");
  expect(clientReceived).toBe("Echo: Hello QUIC!");
  expect(serverStreamCount).toBeGreaterThan(0);
  expect(clientStreamCount).toBeGreaterThan(0);
  
  // Clean up
  server.close();
  client.close();
  
  console.log("\n=== Test Complete ===\n");
});