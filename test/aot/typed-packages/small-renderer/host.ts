// The host of the programs in this folder: boxes and texts in memory, and a way to print them.
import type { Host, Props } from "small-renderer";

export type Text = { kind: "text"; text: string; parent: Box | null };
export type Box = { kind: "box"; name: string; props: Props; children: (Box | Text)[]; parent: Box | null };

export const createBox = (name: string, props: Props): Box => ({
  kind: "box",
  name,
  props,
  children: [],
  parent: null,
});

function remove(parent: Box, child: Box | Text) {
  const at = parent.children.indexOf(child);
  if (at >= 0) parent.children.splice(at, 1);
  child.parent = null;
}

export function print(node: Box | Text): string {
  if (node.kind === "text") return node.text;
  const label = typeof node.props.label === "string" ? ` ${node.props.label}` : "";
  return `<${node.name}${label}>${node.children.map(print).join("")}</${node.name}>`;
}

export const createHost = (afterCommit: (container: Box) => void): Host => ({
  createBox,
  createText: (text: string): Text => ({ kind: "text", text, parent: null }),
  append(parent: Box, child: Box | Text) {
    if (child.parent) remove(child.parent, child);
    child.parent = parent;
    parent.children.push(child);
  },
  insertBefore(parent: Box, child: Box | Text, before: Box | Text) {
    if (child.parent) remove(child.parent, child);
    child.parent = parent;
    parent.children.splice(parent.children.indexOf(before), 0, child);
  },
  remove,
  updateBox(box: Box, props: Props) {
    box.props = props;
  },
  updateText(node: Text, text: string) {
    node.text = text;
  },
  afterCommit,
});
