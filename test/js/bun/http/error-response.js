const s = Bun.serve({
  fetch(req, res) {
    throw new Error("1");
  },
  port: 0,
});
try {
  await fetch(`http://${s.hostname}:${s.port}`).then(res => console.log(res.status));
} finally {
  s.close();
}
