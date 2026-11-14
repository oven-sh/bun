const top = import.meta.glob<string>("./pages/*.ts", { eager: true, import: "name" });

export function Pages({ prefix }: { prefix: string }) {
  const lazy = import.meta.glob("./pages/*.ts");
  const eager = import.meta.glob<string>("./pages/a.ts", { eager: true, import: "name" });
  const keys = Object.keys(lazy).map(key => prefix + key);
  return <p title={keys.join()}>{[JSON.stringify(eager), JSON.stringify(top)].join(" | ")}</p>;
}
