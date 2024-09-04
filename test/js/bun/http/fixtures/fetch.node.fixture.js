fetch(process.env.URL)
  .then(res => {
    if (res.status !== 200 || res.url !== process.env.URL) {
      process.exit(1);
    }
    if (process.env.LABEL === "access .body") {
      res.body;
    }
    return res[process.env.METHOD]();
  })
  .then(async output => {
    if (process.env.METHOD === "blob") {
      output = await output.arrayBuffer();
    }
    process.stdout.write(Buffer.from(output));
    process.exit(0);
  });
