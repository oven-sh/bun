self.onmessage = async event => {
  const { run } = await import("./terminated.py");
  run(event.data);
};
