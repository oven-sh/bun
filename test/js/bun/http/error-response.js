const s = Bun.serve({
  fetch(req, res) {
    s.stop(true);
    throw new Error("1");
  },
  port: 0,
});
fetch(`http://${s.hostname}:${s.port}`).then(res => console.log(res.status));
