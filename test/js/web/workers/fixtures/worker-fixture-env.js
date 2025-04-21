Bun.inspect(process.env);

onmessage = () => {
  postMessage({
    env: process.env,
    hello: process.env.hello,
  });
};
