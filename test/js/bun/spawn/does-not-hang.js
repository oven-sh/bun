const s = Bun.spawn({
  cmd: ["sleep", "999999"],
});

s.unref();
