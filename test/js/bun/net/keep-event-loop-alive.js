(async () => {
  const port = process.argv[2] ? parseInt(process.argv[2]) : null;
  const hostname = process.argv[3] ? process.argv[3] : "localhost";
  await Bun.sleep(10);
  // failed connection
  console.log("test 1: failed connection");
  try {
    const socket = await Bun.connect({
      hostname: hostname,
      port: 9999,
      socket: { data() {} },
    });
    socket.end();
  } catch (error) {}
  // failed connection tls
  console.log("test 2: failed connection [tls]");
  try {
    const socket = await Bun.connect({
      hostname: hostname,
      port: 9999,
      socket: { data() {} },
      tls: true,
    });
    socket.end();
  } catch (error) {}
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
