import { createFileRoute } from "@tanstack/react-router";
import { fetchContacts } from "../utils/items";

export const Route = createFileRoute("/contacts")({
  loader: async () => fetchContacts(),
  component: Contacts,
});

function Contacts() {
  const contacts = Route.useLoaderData();
  return (
    <ul>
      {contacts.map(contact => (
        <li key={contact.id}>
          {contact.name} ({contact.email})
        </li>
      ))}
    </ul>
  );
}
