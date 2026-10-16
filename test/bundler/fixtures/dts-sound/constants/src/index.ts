import * as keys from "./keys";
import { KEY, NAME, NIL, NOTHING, Kind, Color, OTHER } from "./keys";
declare const injected: number;
export interface Marked { [KEY]?: boolean; [keys.OTHER]: number; name: string }
export type Tools = { Unused: typeof keys.Unused; used: typeof keys.used };
interface Leaf { kind: Kind.Leaf; value: number }
interface Branch { kind: Kind.Branch; left: Tree; right: Tree }
export type Tree = Leaf | Branch;
export function sum(tree: Tree): number {
  switch (tree.kind) {
    case Kind.Leaf:
      return tree.value;
    case Kind.Branch:
      return sum(tree.left) + sum(tree.right);
  }
}
export function leaf(value: number): Tree {
  return { kind: Kind.Leaf, value };
}
export function paint(color: Color = Color.Red): Color {
  return color === Color.Blue ? Color.Red : (Color.Blue as Color);
}
export function mark(target: object, name: unknown): Marked {
  const marked = target as Marked;
  (target as { [KEY]?: boolean })[KEY] = true;
  marked[OTHER] = keys.used() + injected;
  const record: Record<typeof NAME, string> = { [NAME]: "x" };
  return { name: name as string, [OTHER]: record[NAME].length, [KEY]: NIL ?? NOTHING ?? undefined };
}
export * as everything from "./keys";
export function pick(name: keyof typeof keys): unknown {
  return keys[name];
}
export function depth(tree: Tree, flag: number): number {
  const first = tree.kind === Kind.Branch ? +flag : -flag;
  return first + (flag & Kind.Branch | flag);
}
export class Machine {
  state = Kind.Leaf;
  readonly first = Kind.Leaf;
  step(next = Color.Red): Kind {
    let color = Color.Blue;
    color = next;
    this.state = color === Color.Red ? Kind.Branch : Kind.Leaf;
    return this.state;
  }
}
