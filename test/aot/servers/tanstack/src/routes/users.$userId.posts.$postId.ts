import { createFileRoute } from "@tanstack/react-router";
import { postPage } from "../utils/shared";

export const Route = createFileRoute("/users/$userId/posts/$postId")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const query = new URL(request.url).searchParams;
        return Response.json(postPage(params.userId, params.postId, query.get("page"), query.get("limit"), query.get("sort")));
      },
    },
  },
});
