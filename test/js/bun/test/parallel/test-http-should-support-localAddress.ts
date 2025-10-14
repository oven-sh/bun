import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const { localAddress, localFamily, localPort } = req.socket;
    res.end();
    server.close();
    expect(localAddress).toStartWith("127.");
    expect(localFamily).toBe("IPv4");
    expect(localPort).toBeGreaterThan(0);
    resolve();
  });
  server.listen(0, "127.0.0.1", () => {
    http.request(`http://localhost:${server.address().port}`).end();
  });
});

await new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const { localAddress, localFamily, localPort } = req.socket;
    res.end();
    server.close();
    expect(localAddress).toStartWith("::");
    expect(localFamily).toBe("IPv6");
    expect(localPort).toBeGreaterThan(0);
    resolve();
  });
  server.listen(0, "::1", () => {
    http.request(`http://[::1]:${server.address().port}`).end();
  });
});
