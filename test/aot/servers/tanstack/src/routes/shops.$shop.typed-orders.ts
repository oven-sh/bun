import { createFileRoute } from "@tanstack/react-router";
import { invalidOrder, placeTypedOrder, type OrderBody } from "../utils/shared";

export const Route = createFileRoute("/shops/$shop/typed-orders")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const receipt = placeTypedOrder(params.shop, (await request.json()) as OrderBody);
          return receipt ? Response.json(receipt) : Response.json(invalidOrder, { status: 400 });
        } catch {
          return Response.json(invalidOrder, { status: 400 });
        }
      },
    },
  },
});
