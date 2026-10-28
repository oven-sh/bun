import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const files = {
  "main.cjs": `
    const http = require("node:http");
    const net = require("node:net");
    const describe = (object, name) => {
      const found = Object.getOwnPropertyDescriptor(object, name);
      if (!found) return name + ": none";
      return name + ": " + ("value" in found ? "data " + String(found.value) : "accessor") + " " + [found.writable, found.enumerable, found.configurable].join();
    };
    const names = ["writable", "chunkedEncoding", "shouldKeepAlive", "_keepAliveTimeout", "useChunkedEncodingByDefault", "sendDate", "finished", "_hasBody", "statusCode", "statusMessage"];
    const say = (title, response) => console.log(title + "\\n  " + names.map(name => describe(response, name)).join("\\n  ") + "\\n  " + Object.keys(response).join() + "\\n  " + Object.getOwnPropertySymbols(response).map(String).join() + "\\n  " + response.writableHighWaterMark);
    console.log(http.ServerResponse.length, http.OutgoingMessage.length, names.filter(name => name in http.ServerResponse.prototype).join());

    const request = { method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 };
    say("alone", new http.ServerResponse(request));
    say("called", http.ServerResponse(request));
    say("options", new http.ServerResponse(request, { highWaterMark: 5, rejectNonStandardBodyWrites: true }));
    say("more arguments", new http.ServerResponse(request, { highWaterMark: 6 }, { end() {} }, 7, true, 8));
    say("HEAD", new http.ServerResponse({ method: "HEAD", httpVersionMajor: 1, httpVersionMinor: 1 }));
    say("1.0", new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 0, headers: { te: "chunked" } }));
    say("outgoing", new http.OutgoingMessage({ highWaterMark: 9 }));
    say("outgoing, more arguments", new http.OutgoingMessage({ highWaterMark: 9 }, 10, true, 11));
    const inherited = Object.create(http.ServerResponse.prototype);
    console.log("inherited", inherited.writable, inherited.chunkedEncoding, inherited.shouldKeepAlive);

    class Response extends http.ServerResponse {
      constructor(request, options) {
        super(request, options);
        this.optionKeys = Reflect.ownKeys(options).map(String).join();
      }
    }

    function get(port, head) {
      return new Promise(resolve => {
        let text = "";
        const socket = net.connect(port, "127.0.0.1", () => socket.write(head));
        socket.setEncoding("latin1");
        socket.on("data", chunk => (text += chunk));
        socket.on("close", () => resolve(text.replace(/Date: [^\\r]*/, "Date: -")));
      });
    }

    async function serve(title, options, change) {
      const server = http.createServer(options, (req, res) => {
        say(title, res);
        if (res.optionKeys) console.log("  " + res.optionKeys);
        change?.(res);
        res.end("ok");
      });
      server.keepAliveTimeout = 7000;
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();
      console.log(JSON.stringify(await get(port, "GET / HTTP/1.1\\r\\nHost: a\\r\\nConnection: close\\r\\n\\r\\n")));
      console.log(JSON.stringify(await get(port, "GET / HTTP/1.0\\r\\n\\r\\n")));
      await new Promise(resolve => server.close(resolve));
    }

    (async () => {
      await serve("served", {});
      await serve("served, options", { highWaterMark: 4096, rejectNonStandardBodyWrites: true });
      await serve("served, a class of the user", { ServerResponse: Response });
      await serve("served, stored to", {}, res => {
        res.writable = false;
        res.chunkedEncoding = true;
        res.shouldKeepAlive = false;
        console.log("  " + [res.writable, res.chunkedEncoding, res.shouldKeepAlive].join());
      });
    })();
  `,
};

test.skipIf(!!unsupported)(
  "a ServerResponse has the own properties that it has under bun run",
  async () => {
    using dir = tempDir("aot-server-response-own-properties", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.cjs"], String(dir), bunEnv);
    expect({ servedEveryRequest: plain.stdout.includes("served, stored to"), exitCode: plain.exitCode }).toEqual({
      servedEveryRequest: true,
      exitCode: 0,
    });
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  240_000,
);
