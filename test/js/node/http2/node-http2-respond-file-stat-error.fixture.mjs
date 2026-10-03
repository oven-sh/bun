// A respondWithFD()/respondWithFile() whose fstat fails, or whose path is a directory, with no
// onError handler. Prints one line per event so the test can compare the order with node.
import fs from "node:fs";
import http2 from "node:http2";
import os from "node:os";

process.on("uncaughtException", e => {
  console.log("  uncaughtException:", e.code);
  process.exit(1);
});

function closedFd() {
  const fd = fs.openSync(os.tmpdir(), "r");
  fs.closeSync(fd);
  return fd;
}

const calls = {
  "respondWithFD(closed fd), statCheck": st => st.respondWithFD(closedFd(), { ":status": 200 }, { statCheck() {} }),
  "respondWithFD(closed fd), no statCheck": st => st.respondWithFD(closedFd(), { ":status": 200 }),
  "respondWithFile(directory)": st => st.respondWithFile(os.tmpdir(), { ":status": 200 }),
  "respondWithFD(closed fd), statCheck, then destroy()": st => {
    st.respondWithFD(closedFd(), { ":status": 200 }, { statCheck() {} });
    st.destroy();
  },
  "respondWithFD(closed fd), no statCheck, then destroy()": st => {
    st.respondWithFD(closedFd(), { ":status": 200 });
    st.destroy();
  },
  "respondWithFD(closed fd), no statCheck, onError": st =>
    st.respondWithFD(closedFd(), { ":status": 200 }, { onError: e => console.log("  onError:", e.code) }),
  "respondWithFD(-1), no statCheck": st => st.respondWithFD(-1, { ":status": 200 }),
  "respondWithFD(fd, request pseudo-header), no statCheck": st =>
    st.respondWithFD(fs.openSync(os.tmpdir(), "r"), { ":status": 200, ":path": "/" }),
  "close(), then respondWithFD(closed fd)": st => {
    st.close();
    st.respondWithFD(closedFd(), { ":status": 200 });
  },
  "close(), then respondWithFile(directory)": st => {
    st.close();
    st.respondWithFile(os.tmpdir(), { ":status": 200 });
  },
};

const server = http2.createServer();
server.on("stream", (stream, headers) => {
  stream.on("error", e => console.log("  server stream error:", e.code));
  try {
    calls[headers["x-call"]](stream);
  } catch (e) {
    console.log("  sync throw:", e.code);
  }
});
server.listen(0, "127.0.0.1", async () => {
  const client = http2.connect("http://127.0.0.1:" + server.address().port);
  for (const name of Object.keys(calls)) {
    console.log(name);
    await new Promise(resolve => {
      const req = client.request({ ":path": "/", "x-call": name });
      req.on("response", h => console.log("  client 'response':", h[":status"]));
      req.on("error", e => console.log("  client error:", e.message));
      req.on("close", resolve);
      req.resume();
      req.end();
    });
  }
  client.close();
  server.close();
});
