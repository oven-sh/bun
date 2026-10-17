import { LIMIT as limit } from "./limits";
export declare const LIMIT: "import it from ./limits";
declare const injected: number;
const seen: string[] = [];
export const visit: { (node: string): void; BREAK: symbol; SKIP: symbol } = function visit(node) {
  if (seen.length < limit + injected) seen.push(node);
};
visit.BREAK = Symbol("break");
visit.SKIP = Symbol("skip");
