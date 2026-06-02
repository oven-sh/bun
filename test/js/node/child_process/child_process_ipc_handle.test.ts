import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Passing a net.Server handle over IPC duplicates the listening socket's fd to
// the child via SCM_RIGHTS, which is POSIX-only.
test.skipIf(isWindows)("fork() + subprocess.send(msg, server) gives the child a usable net.Server", async () => {
  using dir = tempDir("ipc-server-handle", {
    "parent.js": `
import { fork } from 'node:child_process';
import { createServer, connect } from 'node:net';

const child = fork('child.js');
const server = createServer();

function finish(ok, detail) {
  console.log(ok ? 'RESPONSE:' + detail : 'FAILED:' + detail);
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  process.exit(ok ? 0 : 1);
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  child.send('server', server);

  child.on('message', m => {
    if (typeof m === 'object' && m.error) return finish(false, m.error);
    if (m !== 'ready') return;
    // The fd is duplicated to the child (SCM_RIGHTS), so both processes would
    // otherwise race on accept(). The child has already called
    // server.listen({ fd }) before sending 'ready', so closing our copy now
    // leaves only the child's fd accepting — deterministically the child
    // answers the connection.
    server.close();
    const client = connect(port, '127.0.0.1');
    client.setEncoding('utf8');
    let data = '';
    client.on('data', chunk => { data += chunk; });
    client.on('end', () => finish(true, data));
    client.on('error', err => finish(false, 'client:' + err.message));
  });
});
`,
    "child.js": `
process.on('message', (m, server) => {
  if (m !== 'server') return;
  console.log('CHILD_TYPEOF:' + typeof server);
  if (!server || typeof server.on !== 'function') {
    process.send({ error: 'handle was ' + typeof server });
    return;
  }
  server.on('connection', socket => {
    socket.end('Hello from child');
  });
  process.send('ready');
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("CHILD_TYPEOF:object");
  expect(stdout).toContain("RESPONSE:Hello from child");
  expect(exitCode).toBe(0);
});
