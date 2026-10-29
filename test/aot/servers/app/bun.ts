import {
  catalog,
  exportProducts,
  invalidOrder,
  placeCheckedOrder,
  placeOrder,
  placeTypedOrder,
  postPage,
  summarize,
  type OrderBody,
} from "./shared";

const encoder = new TextEncoder();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/text": () => new Response("Hello, World!"),
    "/json": () => Response.json(catalog(42)),
    "/users/:userId/posts/:postId": (request) => {
      const query = new URL(request.url).searchParams;
      const { userId, postId } = request.params;
      return Response.json(postPage(userId, postId, query.get("page"), query.get("limit"), query.get("sort")));
    },
    "/shops/:shop/orders": {
      POST: async (request) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(invalidOrder, { status: 400 });
        }
        const receipt = placeOrder(request.params.shop, body);
        return receipt ? Response.json(receipt) : Response.json(invalidOrder, { status: 400 });
      },
    },
    "/shops/:shop/typed-orders": {
      POST: async (request) => {
        try {
          const order = (await request.json()) as OrderBody;
          const receipt = placeTypedOrder(request.params.shop, order);
          return receipt ? Response.json(receipt) : Response.json(invalidOrder, { status: 400 });
        } catch {
          return Response.json(invalidOrder, { status: 400 });
        }
      },
    },
    "/shops/:shop/checked-orders": {
      POST: async (request) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(invalidOrder, { status: 400 });
        }
        const receipt = placeCheckedOrder(request.params.shop, body);
        return receipt ? Response.json(receipt) : Response.json(invalidOrder, { status: 400 });
      },
    },
    "/async/:id": async (request) => Response.json(await summarize(Number(request.params.id))),
    "/stream": () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for await (const chunk of exportProducts()) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/csv" } },
      ),
  },
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("listening", server.port);
