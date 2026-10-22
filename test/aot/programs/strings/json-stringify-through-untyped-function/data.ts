export interface Profile {
  id: number;
  name: string;
  active: boolean;
  score: number;
}

export interface Item {
  id: number;
  title: string;
  priceCents: number;
  inStock: boolean;
}

export interface Catalog {
  profile: Profile;
  items: Item[];
}

export interface Page {
  page: number;
  sort: string;
}

interface ProductRow {
  id: number;
  title: string;
  priceCents: number;
  stock: number;
}

const names = ["Ada", "Grace"];
const products: ProductRow[] = [];
for (let id = 1; id <= 50; id++) products.push({ id, title: ["Product", id].join(" "), priceCents: 199 + id * 350, stock: id % 7 });

export function catalog(userId: number): Catalog {
  return {
    profile: { id: userId, name: names[userId % names.length]!, active: userId % 2 === 0, score: userId + 0.5 },
    items: products.map((product) => ({
      id: product.id,
      title: product.title,
      priceCents: product.priceCents,
      inStock: product.stock > 0,
    })),
  };
}

export function page(number: number, sort: string | undefined): Page {
  return { page: number, sort: sort ?? "new" };
}
