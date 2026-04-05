import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// IPC socket handle passing uses SCM_RIGHTS which is POSIX-only
test.skipIf(isWindows)(
  "cluster.send() preserves socket handle",
  async () => {
    using dir = tempDir("issue-28759", {
      "index.cjs": `
const cluster = require('cluster');
const net = require('net');

if (cluster.isMaster) {
  const worker = cluster.fork();

  worker.on('message', function(m, h) {
    const isSocket = h instanceof net.Socket;
    console.log('master recv: cmd=' + m.cmd + ', isSocket=' + isSocket);
    worker.kill();
    server.close();
    process.exit(0);
  });

  const server = net.createServer();
  server.listen(0, '127.0.0.1', function() {
    worker.on('online', function() {
      const sock = new net.Socket();
      sock.connect(server.address().port, '127.0.0.1', function() {
        console.log('master sending socket');
        worker.send({ cmd: 'syn', data: 'hello' }, sock);
      });
    });
  });
} else {
  process.on('message', function(m, h) {
    const isSocket = h instanceof net.Socket;
    console.log('worker recv: cmd=' + m.cmd + ', isSocket=' + isSocket);
    process.send({ cmd: 'ack' }, h);
  });
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("master sending socket");
    expect(stdout).toContain("worker recv: cmd=syn, isSocket=true");
    expect(stdout).toContain("master recv: cmd=ack, isSocket=true");
    expect(exitCode).toBe(0);
  },
  30_000,
);

test.skipIf(isWindows)(
  "process.send() preserves socket handle with large payload",
  async () => {
    using dir = tempDir("issue-28759-large", {
      "index.cjs": `
const cluster = require('cluster');
const net = require('net');

if (cluster.isMaster) {
  const worker = cluster.fork();

  worker.on('message', function(m, h) {
    const isSocket = h instanceof net.Socket;
    console.log('master recv: cmd=' + m.cmd + ', dataLen=' + m.data.length + ', isSocket=' + isSocket);
    worker.kill();
    server.close();
    process.exit(0);
  });

  const server = net.createServer();
  server.listen(0, '127.0.0.1', function() {
    worker.on('online', function() {
      const sock = new net.Socket();
      sock.connect(server.address().port, '127.0.0.1', function() {
        const data = [];
        for (var i = 0; i < 30000; i++) {
          data[i] = '1';
        }
        console.log('master sending socket with large payload');
        worker.send({ cmd: 'syn', data: data }, sock);
      });
    });
  });
} else {
  process.on('message', function(m, h) {
    const isSocket = h instanceof net.Socket;
    console.log('worker recv: cmd=' + m.cmd + ', dataLen=' + m.data.length + ', isSocket=' + isSocket);
    process.send({ cmd: 'ack', data: m.data }, h);
  });
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("master sending socket with large payload");
    expect(stdout).toContain("worker recv: cmd=syn, dataLen=30000, isSocket=true");
    expect(stdout).toContain("master recv: cmd=ack, dataLen=30000, isSocket=true");
    expect(exitCode).toBe(0);
  },
  30_000,
);
