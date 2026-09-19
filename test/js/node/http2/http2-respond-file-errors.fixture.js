// Answer each request with a file response that cannot succeed and report what the server stream
// and the client request saw. node-http2.test.js runs the scenarios in its own process and runs
// this file under Node.js: both must report the same. Nothing here handles 'uncaughtException',
// so a throw inside the fs callback of a scenario fails the caller.
const http2 = require("node:http2");
const fs = require("node:fs");

// Never a valid descriptor: fstat and read fail with EBADF. A descriptor that was opened and closed
// again could be handed out once more before the fstat runs.
const badFd = 2 ** 30;
const invalidHeaders = { ":method": "GET" };

// The stream is gone when fstat returns. Node.js sends the headers of a respondWithFD() without a
// statCheck at call time and Bun after the fstat, so only the server side is compared here.
const goneScenarios = {
  "respondWithFD(bad fd, statCheck), destroy()": (stream, { statCheck }) => {
    stream.respondWithFD(badFd, {}, { statCheck });
    stream.destroy();
  },
  "respondWithFD(bad fd), destroy()": stream => {
    stream.respondWithFD(badFd);
    stream.destroy();
  },
  "respondWithFD(directory fd), destroy()": (stream, { directoryFd }) => {
    stream.respondWithFD(directoryFd);
    stream.destroy();
  },
  "respondWithFD(bad fd), close(NGHTTP2_CANCEL)": stream => {
    stream.respondWithFD(badFd);
    stream.close(http2.constants.NGHTTP2_CANCEL);
  },
};
const failedScenarios = {
  "respondWithFD(bad fd, statCheck)": (stream, { statCheck }) => stream.respondWithFD(badFd, {}, { statCheck }),
  "respondWithFD(bad fd)": stream => stream.respondWithFD(badFd),
  "respondWithFile(directory)": stream => stream.respondWithFile(__dirname),
  "respondWithFile(directory, statCheck)": (stream, { statCheck }) =>
    stream.respondWithFile(__dirname, {}, { statCheck }),
  "respondWithFD(bad fd, statCheck), invalid headers": (stream, { statCheck }) =>
    stream.respondWithFD(badFd, invalidHeaders, { statCheck }),
  "respondWithFD(bad fd), invalid headers": stream => stream.respondWithFD(badFd, invalidHeaders),
  "respondWithFile(directory), invalid headers": stream => stream.respondWithFile(__dirname, invalidHeaders),
};

async function runRespondFileErrorScenarios() {
  let statCheckCalls = 0;
  const context = { statCheck: () => void statCheckCalls++, directoryFd: fs.openSync(__dirname, "r") };
  const serverStreams = {};
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    const name = headers["x-scenario"];
    const errors = [];
    stream.on("error", err => errors.push(err.code));
    stream.on("close", () => serverStreams[name].resolve(errors));
    (goneScenarios[name] || failedScenarios[name])(stream, context);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);

  async function run(name) {
    serverStreams[name] = Promise.withResolvers();
    const clientSaw = new Promise(resolve => {
      const seen = { response: null, error: null };
      const req = client.request({ ":path": "/", "x-scenario": name });
      req.on("response", headers => (seen.response = headers[":status"]));
      req.on("error", err => (seen.error = err.message));
      req.on("close", () => resolve({ ...seen, rstCode: req.rstCode }));
      req.resume();
      req.end();
    });
    const [serverErrors, clientView] = await Promise.all([serverStreams[name].promise, clientSaw]);
    return { server: serverErrors, client: clientView };
  }

  try {
    // The gone scenarios run first: their fstat callbacks return while the rest still runs.
    const result = { gone: {}, failed: {} };
    for (const name of Object.keys(goneScenarios)) {
      result.gone[name] = { server: (await run(name)).server };
    }
    for (const name of Object.keys(failedScenarios)) {
      result.failed[name] = await run(name);
    }
    result.statCheckCalls = statCheckCalls;
    return result;
  } finally {
    client.close();
    server.close();
    fs.closeSync(context.directoryFd);
  }
}

module.exports = { runRespondFileErrorScenarios };

if (require.main === module) {
  runRespondFileErrorScenarios().then(result => console.log(JSON.stringify(result)));
}
