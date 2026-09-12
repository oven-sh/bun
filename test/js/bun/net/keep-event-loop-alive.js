(async () => {
  const port = process.argv[2] ? parseInt(process.argv[2]) : null;
  const hostname = process.argv[3] ? process.argv[3] : "localhost";
  // A port nothing listens on. The test passes one it keeps bound for the run.
  const refusedPort = process.argv[4] ? parseInt(process.argv[4]) : 9999;
  await Bun.sleep(10);
  // failed connection
  try {
    const socket = await Bun.connect({
      hostname: hostname,
      port: refusedPort,
      socket: { data() {} },
    });
    socket.end();
    console.log("test 1: failed connection did not fail");
  } catch (error) {
    console.log("test 1: failed connection", error.code);
  }
  // failed connection tls
  try {
    const socket = await Bun.connect({
      hostname: hostname,
      port: refusedPort,
      socket: { data() {} },
      tls: true,
    });
    socket.end();
    console.log("test 2: failed connection [tls] did not fail");
  } catch (error) {
    console.log("test 2: failed connection [tls]", error.code);
  }
  if (port) {
    // successful connection
    console.log("test 3: successful connection");
    const socket = await Bun.connect({
      hostname: hostname,
      port,
      socket: { data() {} },
    });
    socket.end();

    // successful connection tls
    console.log("test 4: successful connection [tls]");
    const socket2 = await Bun.connect({
      hostname: hostname,
      port,
      socket: { data() {} },
    });
    socket2.end();
  } else {
    console.log("run with a port as an argument to try the success situation");
  }
  console.log("success: event loop was not killed");
})();
