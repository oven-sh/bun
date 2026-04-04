import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("node:http upgrade socket hands off to userland for bidirectional communication", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
import http from "node:http";
import net from "node:net";

const server = http.createServer();

server.on("upgrade", (req, socket, head) => {
  socket.write(
    "HTTP/1.1 101 Switching Protocols\\r\\n" +
    "Upgrade: custom\\r\\n" +
    "Connection: Upgrade\\r\\n" +
    "\\r\\n"
  );

  socket.on("data", (chunk) => {
    socket.write("ECHO:" + chunk.toString());
  });

  socket.resume();
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;

  const client = net.connect(port, "127.0.0.1", () => {
    client.write(
      "GET / HTTP/1.1\\r\\n" +
      "Host: 127.0.0.1\\r\\n" +
      "Upgrade: custom-protocol\\r\\n" +
      "Connection: Upgrade\\r\\n" +
      "\\r\\n"
    );
  });

  let gotUpgrade = false;
  let buf = "";

  client.on("data", (chunk) => {
    buf += chunk.toString();

    if (!gotUpgrade && buf.includes("\\r\\n\\r\\n")) {
      gotUpgrade = true;
      client.write("hello from client");
    }

    if (buf.includes("ECHO:")) {
      console.log(buf.substring(buf.indexOf("ECHO:")));
      client.end();
      server.close(() => process.exit(0));
    }
  });

  setTimeout(() => {
    console.error("TIMEOUT");
    process.exit(1);
  }, 5000);
});
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("TIMEOUT");
  expect(stdout.trim()).toBe("ECHO:hello from client");
  expect(exitCode).toBe(0);
});
