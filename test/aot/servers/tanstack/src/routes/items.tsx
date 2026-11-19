import { Link, createFileRoute } from "@tanstack/react-router";
import { fetchItems } from "../utils/items";

export const Route = createFileRoute("/items")({
  loader: async () => fetchItems(),
  component: Items,
});

function Items() {
  const items = Route.useLoaderData();
  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>
          <Link to="/items/$itemId" params={{ itemId: String(item.id) }} activeProps={{ className: "active" }}>
            <div>{item.title}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
