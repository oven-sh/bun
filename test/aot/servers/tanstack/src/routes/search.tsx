import { createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import * as z from "zod";
import { fetchItems } from "../utils/items";

export const Route = createFileRoute("/search")({
  validateSearch: z.object({ page: z.coerce.number().int().min(1).catch(1), word: z.string().catch("") }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => (await fetchItems()).filter(item => item.title.includes(deps.word)).slice((deps.page - 1) * 5, deps.page * 5),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.length ?? 0} found` }] }),
  component: Search,
});

function Search() {
  const { page, word } = Route.useSearch();
  const found = Route.useLoaderData();
  const id = useId();
  return (
    <form>
      <label htmlFor={id}>Word</label>
      <input id={id} name="word" defaultValue={word} />
      <output>
        page {page}: {found.map(item => item.id).join(" ")}
      </output>
    </form>
  );
}
