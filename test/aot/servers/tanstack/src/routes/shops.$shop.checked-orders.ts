import { createFileRoute } from "@tanstack/react-router";
import { invalidOrder, placeCheckedOrder } from "../utils/shared";

export const Route = createFileRoute("/shops/$shop/checked-orders")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(invalidOrder, { status: 400 });
        }
        const receipt = placeCheckedOrder(params.shop, body);
        return receipt ? Response.json(receipt) : Response.json(invalidOrder, { status: 400 });
      },
    },
  },
});
