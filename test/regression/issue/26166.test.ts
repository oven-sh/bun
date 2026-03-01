import { udpSocket } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26166
// On Windows, ICMP "Port Unreachable" messages cause WSAECONNRESET errors which
// would close the UDP socket entirely. This test verifies the socket stays alive.
test("UDP socket survives sending to unreachable port", async () => {
  let receivedCount = 0;
  const receivedData: string[] = [];
  const { resolve, reject, promise } = Promise.withResolvers<void>();

  // Create a server socket
  const server = await udpSocket({
    socket: {
      data(socket, data, port, address) {
        receivedCount++;
        receivedData.push(new TextDecoder().decode(data));
        if (receivedCount === 2) {
          resolve();
        }
      },
    },
  });

  // Create a client
  const client = await udpSocket({});

  // Send first message to the server
  client.send(Buffer.from("message1"), server.port, "127.0.0.1");

  // Wait a bit for message to be received
  await Bun.sleep(50);

  // Now send to an unreachable port (a port that's definitely not listening)
  // This would trigger an ICMP Port Unreachable on Windows
  const unreachablePort = 59999;
  server.send(Buffer.from("this will fail"), unreachablePort, "127.0.0.1");

  // Wait a bit for the ICMP error to potentially be processed
  await Bun.sleep(100);

  // Send second message - this should still work if the socket survived
  client.send(Buffer.from("message2"), server.port, "127.0.0.1");

  // Wait for messages with timeout
  const timeout = setTimeout(() => reject(new Error("Timeout waiting for messages")), 2000);

  try {
    await promise;
    clearTimeout(timeout);
  } finally {
    server.close();
    client.close();
  }

  expect(receivedCount).toBe(2);
  expect(receivedData).toContain("message1");
  expect(receivedData).toContain("message2");
});
