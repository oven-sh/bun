const encoder = new TextEncoder();

class OutOfStock extends Error {}

let announce = (text: string): void => {};
const left = { aborted: 0, cancelled: 0 };

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  development: false,
  routes: {
    "/fixed": new Response("the same every time", { headers: { "X-Fixed": "yes" } }),
    "/fixed.json": Response.json({ fixed: true }),
    "/methods": {
      GET: () => new Response("got"),
      PUT: async request => new Response(`put ${(await request.text()).length}`),
      DELETE: () => new Response(null, { status: 204 }),
    },
    "/things/:id": request => Response.json({ id: request.params.id, url: new URL(request.url).pathname }),
    "/things/:id/parts/:part": request => Response.json(request.params),
    "/rest/*": request => new Response(new URL(request.url).pathname),
    "/moved": () => Response.redirect("/fixed", 301),
    "/headers": request => {
      const headers = new Headers({ "X-One": "1" });
      headers.append("X-One", "2");
      headers.append("Set-Cookie", "a=1");
      headers.append("Set-Cookie", "b=2; HttpOnly");
      return Response.json({ names: [...request.headers.keys()].sort(), custom: request.headers.get("x-custom"), method: request.method }, { headers });
    },
    "/cookies": request => {
      const visits = Number(request.cookies.get("visits") ?? 0) + 1;
      request.cookies.set("visits", String(visits), { httpOnly: true, path: "/", sameSite: "lax" });
      request.cookies.delete("old");
      return Response.json({ visits, all: Object.fromEntries(request.cookies) });
    },
    "/address": (request, server) => Response.json({ address: server.requestIP(request)?.address, family: server.requestIP(request)?.family }),
    "/generator": () =>
      new Response(
        (async function* () {
          for (let n = 0; n < 5; n++) yield `${n}\n`;
        })(),
        { headers: { "Content-Type": "text/plain" } },
      ),
    "/stream": () =>
      new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            for (let n = 0; n < 5; n++) {
              controller.write(encoder.encode(`${n},`));
              await controller.flush();
            }
            controller.close();
          },
        }),
      ),
    "/events": request => {
      request.signal.addEventListener("abort", () => left.aborted++);
      let sent = 0;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            controller.enqueue(encoder.encode(`id: ${++sent}\ndata: tick\n\n`));
            await Bun.sleep(2);
          },
          cancel() {
            left.cancelled++;
          },
        }),
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } },
      );
    },
    "/left": () => Response.json(left),
    "/blob": () => new Response(new Blob(["<p>blob</p>"], { type: "text/html" })),
    "/bytes": () => new Response(new Uint8Array(300).map((_, index) => index)),
    "/form": {
      POST: async request => {
        const form = await request.formData();
        return Response.json([...form].map(([name, value]) => [name, typeof value === "string" ? value : [value.name, value.type, value.size]]));
      },
    },
    "/json": {
      POST: async request => Response.json({ got: await request.json() }),
    },
    "/buffer": {
      POST: async request => Response.json({ bytes: (await request.arrayBuffer()).byteLength, used: request.bodyUsed }),
    },
    "/clone": {
      POST: async request => {
        const copy = request.clone();
        return Response.json([await request.text(), await copy.text()]);
      },
    },
    "/throws": () => {
      throw new RangeError("out of range");
    },
    "/rejects": async () => {
      throw new OutOfStock("none left");
    },
    "/not-a-response": () => "text" as unknown as Response,
  },
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/socket" && server.upgrade(request, { data: { name: url.searchParams.get("name") ?? "nobody" } })) return;
    return Response.json({ missing: url.pathname, method: request.method }, { status: 404 });
  },
  websocket: {
    data: {} as { name: string },
    open(socket) {
      socket.subscribe("room");
      socket.send(`hello ${socket.data.name}`);
    },
    message(socket, message) {
      if (typeof message !== "string") socket.send(new Uint8Array(message).reverse());
      else if (message === "bye") socket.close(4001, "said bye");
      else if (message.startsWith("all:")) socket.publish("room", `${socket.data.name}: ${message.slice(4)}`);
      else socket.send(message.toUpperCase());
    },
    close(socket, code, reason) {
      announce(`${socket.data.name} left: ${code} ${reason}`);
    },
  },
  error(error) {
    return Response.json({ handled: error.name, message: error.message, own: error instanceof OutOfStock }, { status: 500 });
  },
});

announce = text => void server.publish("room", text);

console.log("listening", server.port);
