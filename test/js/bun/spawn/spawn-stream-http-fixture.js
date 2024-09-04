import { serve, spawn } from "bun";

const server = serve({
  port: 0,
  async fetch(req) {
    const { stdout } = spawn({
      cmd: [process.execPath, "--eval", 'console.write("hello world")'],
      env: process.env,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    return new Response(stdout);
  },
});

const response = await fetch(server.url);
console.write(await response.text());
server.stop(true);
