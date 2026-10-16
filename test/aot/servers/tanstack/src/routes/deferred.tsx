import { Await, createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { fetchContacts } from "../utils/items";

export const Route = createFileRoute("/deferred")({
  loader: async () => ({
    now: "loaded before the page was sent",
    later: new Promise<string>(resolve => setTimeout(resolve, 20, "loaded while the page was sent")),
    contacts: fetchContacts(),
  }),
  component: Deferred,
});

function Deferred() {
  const { now, later, contacts } = Route.useLoaderData();
  return (
    <main>
      <p>{now}</p>
      <Suspense fallback={<p>waiting</p>}>
        <Await promise={later}>{text => <p>{text}</p>}</Await>
      </Suspense>
      <Suspense fallback={<p>waiting for contacts</p>}>
        <Await promise={contacts}>{all => <p>{all.length} contacts</p>}</Await>
      </Suspense>
    </main>
  );
}
