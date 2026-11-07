import type { ReactNode } from "react";
import { Article } from "./article";
import { Catalog } from "./catalog";

export function page(name: string): ReactNode {
  return name === "article" ? <Article /> : <Catalog />;
}
