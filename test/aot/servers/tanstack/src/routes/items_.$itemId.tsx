import { createFileRoute, notFound } from "@tanstack/react-router";
import { fetchItems } from "../utils/items";

export const Route = createFileRoute("/items_/$itemId")({
  loader: async ({ params }) => {
    const item = (await fetchItems()).find(item => item.id === Number(params.itemId));
    if (!item) throw notFound();
    return item;
  },
  component: OneItem,
});

function OneItem() {
  const item = Route.useLoaderData();
  return (
    <article>
      <h4>{item.title}</h4>
      <p>{item.body}</p>
    </article>
  );
}
