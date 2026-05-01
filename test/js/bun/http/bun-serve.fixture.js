import { serve, sleep } from "bun";

const server = serve({
  port: 0,

  fetch(request) {
    const { url } = request;
    const { pathname } = new URL(url);
    throw new Error(pathname);
  },

  async error(cause) {
    const { message } = cause;

    if (message === "/async-fulfilled") {
      return new Response("Async fulfilled");
    }

    if (message === "/async-rejected") {
      throw new Error("Async rejected");
    }

    if (message === "/async-pending") {
      await sleep(1);
      return new Response("Async pending");
    }

    if (message === "/async-rejected-pending") {
      await sleep(1);
      throw new Error("Async rejected pending");
    }
  },
});

process.send(`${server.url}`);
