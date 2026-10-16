import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/redirects")({
  loader: () => {
    throw redirect({ to: "/items/$itemId", params: { itemId: "3" }, statusCode: 307 });
  },
});
