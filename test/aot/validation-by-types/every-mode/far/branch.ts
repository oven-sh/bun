import type { Leaf } from "./leaf";
import { unrelated } from "./unrelated";
export interface Branch {
  leaves: Leaf[];
  length: number;
}
export const used = unrelated;
