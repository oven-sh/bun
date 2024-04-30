const path = require("path");

module.exports.TLS_CERT = require("./tls-cert.cjs").TLS_CERT;
module.exports.TLS_OPTIONS = require("./tls-cert.cjs").TLS_OPTIONS;
const nodeExecutable = typeof Bun !== "undefined" ? Bun.which("node") : "node";

exports.nodeEchoServer = async function nodeEchoServer() {
  if (!nodeExecutable) throw new Error("node executable not found");
  const subprocess = require("child_process").spawn(
    nodeExecutable,
    [path.join(__dirname, "node-echo-server.fixture.js")],
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
      console.error(e);
    }
  }
  subprocess.stdout.on("data", readData);
  return await promise;
};
