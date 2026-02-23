const path = require("path");

const TLS_CERT = require("harness").tls;
module.exports.TLS_CERT = TLS_CERT;
module.exports.TLS_OPTIONS = { ca: TLS_CERT.cert };
const nodeExecutable = typeof Bun !== "undefined" ? Bun.which("node") : "node";

exports.nodeEchoServer = async function nodeEchoServer(paddingStrategy = 0) {
  if (!nodeExecutable) throw new Error("node executable not found");
  const subprocess = require("child_process").spawn(
    nodeExecutable,
    [path.join(__dirname, "node-echo-server.fixture.js"), JSON.stringify(TLS_CERT), paddingStrategy ?? 0],
    {
      stdout: "pipe",
      stderr: "inherit",
      stdin: "inherit",
    },
  );
  const { promise, resolve, reject } = Promise.withResolvers();
  subprocess.unref();
  subprocess.stdout.setEncoding("utf8");
  var data = "";
  function readData(chunk) {
    data += chunk;

    try {
      const address = JSON.parse(data);
      const url = `https://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
      subprocess.stdout.off("data", readData);
      resolve({ address, url, subprocess });
    } catch (e) {
      // JSON parse failed, need more data - don't log, just wait for more chunks
    }
  }
  subprocess.on("error", reject);
  subprocess.on("exit", code => {
    if (code !== 0 && code !== null) {
      reject(new Error(`node-echo-server exited with code ${code}`));
    }
  });
  subprocess.stdout.on("data", readData);
  const result = await promise;
  // Add Symbol.asyncDispose for use with `await using`
  result[Symbol.asyncDispose] = async () => {
    result.subprocess?.kill?.(9);
  };
  return result;
};
