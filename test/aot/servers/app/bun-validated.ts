import { invalidOrder, placeParsedOrder, placeValidatedOrder } from "./validated";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/shops/:shop/validated-orders": {
      POST: async (request) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(invalidOrder, { status: 400 });
        }
        const receipt = placeValidatedOrder(request.params.shop, body);
        return receipt ? Response.json(receipt) : Response.json(invalidOrder, { status: 400 });
      },
    },
    "/shops/:shop/parsed-orders": {
      POST: async (request) => {
        const receipt = placeParsedOrder(request.params.shop, await request.text());
        return receipt ? Response.json(receipt) : Response.json(invalidOrder, { status: 400 });
      },
    },
  },
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("listening", server.port);
