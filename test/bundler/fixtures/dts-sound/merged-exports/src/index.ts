import { Kind } from "./kinds";
export interface NameNode {
  kind: typeof Kind.NAME;
}
export function isName(kind: Kind): boolean {
  const seen = new Set<Kind>();
  seen.add(kind);
  return seen.has(Kind.NAME);
}
export { Kind };
