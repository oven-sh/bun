import { Subprocess, spawn } from "bun";
import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe, randomPort } from "harness";
import { WebSocket } from "ws";

let inspectee: Subprocess;

const anyPort = expect.stringMatching(/^\d+$/);
const anyPathname = expect.stringMatching(/^\/[a-z0-9]+$/);
const tests = [
  {
    args: ["--inspect"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=0"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: anyPathname,
    },
  },
  {
    args: [`--inspect=${randomPort()}`],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=localhost"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=localhost/"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: "/",
    },
  },
  {
    args: ["--inspect=localhost:0"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=localhost:0/"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: "/",
    },
  },
  {
    args: ["--inspect=localhost/foo/bar"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: "/foo/bar",
    },
  },
  {
    args: ["--inspect=127.0.0.1"],
    url: {
      protocol: "ws:",
      hostname: "127.0.0.1",
      port: "6499",
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=127.0.0.1/"],
    url: {
      protocol: "ws:",
      hostname: "127.0.0.1",
      port: "6499",
      pathname: "/",
    },
  },
  {
    args: ["--inspect=127.0.0.1:0/"],
    url: {
      protocol: "ws:",
      hostname: "127.0.0.1",
      port: anyPort,
      pathname: "/",
    },
  },
  {
    args: ["--inspect=[::1]"],
    url: {
      protocol: "ws:",
      hostname: "[::1]",
      port: "6499",
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=[::1]:0"],
    url: {
      protocol: "ws:",
      hostname: "[::1]",
      port: anyPort,
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=[::1]:0/"],
    url: {
      protocol: "ws:",
      hostname: "[::1]",
      port: anyPort,
      pathname: "/",
    },
  },
  {
    args: ["--inspect=/"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: "/",
    },
  },
  {
    args: ["--inspect=/foo"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: "/foo",
    },
  },
  {
    args: ["--inspect=/foo/baz/"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: "/foo/baz/",
    },
  },
  {
    args: ["--inspect=:0"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: anyPathname,
    },
  },
  {
    args: ["--inspect=:0/"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: "/",
    },
  },
  {
    args: ["--inspect=ws://localhost/"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: "/",
    },
  },
  {
    args: ["--inspect=ws://localhost:0/"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: anyPort,
      pathname: "/",
    },
  },
  {
    args: ["--inspect=ws://localhost:6499/foo/bar"],
    url: {
      protocol: "ws:",
      hostname: "localhost",
      port: "6499",
      pathname: "/foo/bar",
    },
  },
];

for (const { args, url: expected } of tests) {
  test(`bun ${args.join(" ")}`, async () => {
    inspectee = spawn({
      cwd: import.meta.dir,
      cmd: [bunExe(), ...args, "inspectee.js"],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });

    let url: URL | undefined;
    let stderr = "";
    const decoder = new TextDecoder();
    for await (const chunk of inspectee.stderr as ReadableStream) {
      stderr += decoder.decode(chunk);
      for (const line of stderr.split("\n")) {
        try {
          url = new URL(line);
        } catch {
          // Ignore
        }
        if (url?.protocol.includes("ws")) {
          break;
        }
      }
      if (stderr.includes("Listening:")) {
        break;
      }
    }

    if (!url) {
      process.stderr.write(stderr);
      throw new Error("Unable to find listening URL");
    }

    const { protocol, hostname, port, pathname } = url;
    expect({
      protocol,
      hostname,
      port,
      pathname,
    }).toMatchObject(expected);

    const webSocket = new WebSocket(url);
    expect(
      new Promise<void>((resolve, reject) => {
        webSocket.addEventListener("open", () => resolve());
        webSocket.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
        webSocket.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
      }),
    ).resolves.toBeUndefined();

    webSocket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
    expect(
      new Promise(resolve => {
        webSocket.addEventListener("message", ({ data }) => {
          resolve(JSON.parse(data.toString()));
        });
      }),
    ).resolves.toMatchObject({
      id: 1,
      result: {
        result: {
          type: "number",
          value: 2,
        },
      },
    });

    webSocket.close();
  });
}

// FIXME: Depends on https://github.com/oven-sh/bun/pull/4649
test.todo("bun --inspect=ws+unix:///tmp/inspect.sock");

afterEach(() => {
  inspectee?.kill();
});
