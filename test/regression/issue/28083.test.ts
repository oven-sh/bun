import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

describe("dgram implicit bind on send", () => {
  test("reusePort option works with dgram sockets", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dgram = require("dgram");
        const isWin = process.platform === "win32";

        // Create two sockets with reusePort: true bound to the same port
        const s1 = dgram.createSocket({ type: "udp4", reusePort: !isWin });
        const s2 = dgram.createSocket({ type: "udp4", reusePort: !isWin });

        s1.bind(0, "127.0.0.1", () => {
          const port = s1.address().port;
          process.stdout.write("s1:" + port + "\\n");

          if (isWin) {
            // On Windows, reusePort is not supported - just verify s1 works
            process.stdout.write("ok\\n");
            s1.close();
            s2.close();
            return;
          }

          // On non-Windows, second socket should be able to bind to the same port
          s2.bind(port, "127.0.0.1", () => {
            const port2 = s2.address().port;
            process.stdout.write("s2:" + port2 + "\\n");
            process.stdout.write("same:" + String(port === port2) + "\\n");
            s1.close();
            s2.close();
          });

          s2.on("error", (err) => {
            process.stdout.write("s2error:" + err.message + "\\n");
            s1.close();
            s2.close();
            process.exit(1);
          });
        });

        s1.on("error", (err) => {
          process.stdout.write("s1error:" + err.message + "\\n");
          s1.close();
          process.exit(1);
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    if (isWindows) {
      expect(stdout).toContain("ok\n");
    } else {
      expect(stdout).toContain("same:true\n");
    }
    expect(exitCode).toBe(0);
  });

  test("send() without bind() implicitly binds and delivers the message", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dgram = require("dgram");
        const receiver = dgram.createSocket("udp4");
        const sender = dgram.createSocket("udp4");

        receiver.bind(0, "127.0.0.1", () => {
          const port = receiver.address().port;

          receiver.on("message", (msg, rinfo) => {
            process.stdout.write(msg.toString() + "\\n");
            process.stdout.write(String(rinfo.port > 0) + "\\n");
            sender.close();
            receiver.close();
          });

          sender.send(Buffer.from("hello"), 0, 5, port, "127.0.0.1", (err) => {
            if (err) {
              process.stdout.write("ERROR:" + err.message + "\\n");
              process.exit(1);
            }
            const addr = sender.address();
            process.stdout.write(addr.address + "\\n");
            process.stdout.write(String(addr.port > 0) + "\\n");
          });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("0.0.0.0\ntrue\nhello\ntrue\n");
    expect(exitCode).toBe(0);
  });

  test("listening event fires after implicit bind", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dgram = require("dgram");
        const socket = dgram.createSocket("udp4");
        const target = dgram.createSocket("udp4");
        let listeningFired = false;

        socket.on("listening", () => {
          listeningFired = true;
        });

        target.bind(0, "127.0.0.1", () => {
          const port = target.address().port;
          socket.send(Buffer.from("test"), 0, 4, port, "127.0.0.1", (err) => {
            process.nextTick(() => {
              process.stdout.write(String(listeningFired) + "\\n");
              socket.close();
              target.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("true\n");
    expect(exitCode).toBe(0);
  });

  test("multiple sends without bind() are all delivered", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dgram = require("dgram");
        const receiver = dgram.createSocket("udp4");
        const sender = dgram.createSocket("udp4");
        const messages = [];

        receiver.bind(0, "127.0.0.1", () => {
          const port = receiver.address().port;

          receiver.on("message", (msg) => {
            messages.push(msg.toString());
            if (messages.length === 3) {
              messages.sort();
              process.stdout.write(messages.join(",") + "\\n");
              sender.close();
              receiver.close();
            }
          });

          sender.send(Buffer.from("aaa"), 0, 3, port, "127.0.0.1");
          sender.send(Buffer.from("bbb"), 0, 3, port, "127.0.0.1");
          sender.send(Buffer.from("ccc"), 0, 3, port, "127.0.0.1");
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("aaa,bbb,ccc\n");
    expect(exitCode).toBe(0);
  });

  test("send(buffer, port, address, callback) short form works without bind", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dgram = require("dgram");
        const receiver = dgram.createSocket("udp4");
        const sender = dgram.createSocket("udp4");

        receiver.bind(0, "127.0.0.1", () => {
          const port = receiver.address().port;

          receiver.on("message", (msg) => {
            process.stdout.write(msg.toString() + "\\n");
            sender.close();
            receiver.close();
          });

          sender.send(Buffer.from("short-form"), port, "127.0.0.1", (err) => {
            if (err) {
              process.stdout.write("ERROR:" + err.message + "\\n");
              process.exit(1);
            }
          });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("short-form\n");
    expect(exitCode).toBe(0);
  });

  test("bidirectional communication works with implicit bind (k-rpc pattern)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dgram = require("dgram");
        const receiver = dgram.createSocket("udp4");
        const sender = dgram.createSocket("udp4");

        sender.on("message", (msg) => {
          process.stdout.write("reply:" + msg.toString() + "\\n");
          sender.close();
          receiver.close();
        });

        receiver.bind(0, "127.0.0.1", () => {
          const port = receiver.address().port;

          receiver.on("message", (msg, rinfo) => {
            process.stdout.write("request:" + msg.toString() + "\\n");
            receiver.send(Buffer.from("pong"), 0, 4, rinfo.port, rinfo.address);
          });

          sender.send(Buffer.from("ping"), 0, 4, port, "127.0.0.1");
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("request:ping\nreply:pong\n");
    expect(exitCode).toBe(0);
  });
});
