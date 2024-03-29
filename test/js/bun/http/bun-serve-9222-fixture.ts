import { serve, Serve, Server, sleep } from "bun";

declare global {
  // eslint-disable-next-line no-var
  var server: Server;
}

const parseBody = async (request: Request): Promise<unknown | null> => {
  if (request.body) {
    const body = await request.json();
    return body;
  } else {
    return null;
  }
};

const bootstrap = (): Server => {
  const options: Serve = {
    port: 0,
    development: true,
    async fetch(request: Request): Promise<Response> {
      await sleep(200 + Math.random() * 100);
      const body = await parseBody(request);
      return new Response(JSON.stringify(body));
    },
  };

  if (!global.server) {
    global.server = serve(options);
  } else {
    global.server.reload(options);
  }

  return global.server;
};

const server = bootstrap();
console.write(server.url.toString());
process.on("beforeExit", () => global.server.stop(true));
