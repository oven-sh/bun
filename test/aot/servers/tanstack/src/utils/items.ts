import { createServerFn } from "@tanstack/react-start";

export interface Item {
  id: number;
  userId: number;
  title: string;
  body: string;
}

export interface Contact {
  id: number;
  name: string;
  email: string;
}

const items: Item[] = Array.from({ length: 100 }, (_, index) => ({
  id: index + 1,
  userId: 1 + Math.floor(index / 10),
  title: `Item ${index + 1}: ${"a title of ordinary length ".repeat(2).trim()}`,
  body: `${"The body of an item is a few sentences long. ".repeat(4).trim()}`,
}));

const contacts: Contact[] = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  name: `Contact ${index + 1}`,
  email: `contact${index + 1}@example.com`,
}));

export const fetchItems = createServerFn().handler(async () => items);

export const fetchContacts = createServerFn().handler(async () => contacts);
