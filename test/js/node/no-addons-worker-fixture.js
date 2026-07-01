onmessage = () => {
  let error = null;
  try {
    process.dlopen({ exports: {} }, "./does-not-exist.node");
  } catch (e) {
    error = e.message;
  }
  postMessage({
    execArgv: process.execArgv,
    error,
  });
};
