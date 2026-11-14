export type Direction = "row" | "column";
export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "between";

export interface Size {
  width: number;
  height: number;
}

export type Measure = (availableWidth: number) => Size;

export class LayoutNode {
  direction: Direction = "row";
  align: Align = "stretch";
  justify: Justify = "start";
  grow = 0;
  shrink = 1;
  gap = 0;
  width: number | undefined = undefined;
  height: number | undefined = undefined;
  minWidth = 0;
  minHeight = 0;
  paddingLeft = 0;
  paddingRight = 0;
  paddingTop = 0;
  paddingBottom = 0;
  marginLeft = 0;
  marginRight = 0;
  marginTop = 0;
  marginBottom = 0;
  border = 0;
  hidden = false;

  parent: LayoutNode | null = null;
  children: LayoutNode[] = [];
  measure: Measure | null = null;

  left = 0;
  top = 0;
  computedWidth = 0;
  computedHeight = 0;

  isDirty = true;
  lastAvailableWidth = -1;
  lastAvailableHeight = -1;

  insert(child: LayoutNode, at: number): void {
    child.parent = this;
    this.children.splice(at, 0, child);
    this.markDirty();
  }

  remove(child: LayoutNode): void {
    const at = this.children.indexOf(child);
    if (at >= 0) this.children.splice(at, 1);
    child.parent = null;
    this.markDirty();
  }

  markDirty(): void {
    for (let node: LayoutNode | null = this; node !== null && !node.isDirty; node = node.parent) node.isDirty = true;
  }
}

const isRow = (direction: Direction) => direction === "row";

function leading(node: LayoutNode, direction: Direction): number {
  return (isRow(direction) ? node.paddingLeft : node.paddingTop) + node.border;
}

function trailing(node: LayoutNode, direction: Direction): number {
  return (isRow(direction) ? node.paddingRight : node.paddingBottom) + node.border;
}

function marginOf(node: LayoutNode, direction: Direction): number {
  return isRow(direction) ? node.marginLeft + node.marginRight : node.marginTop + node.marginBottom;
}

function leadingMargin(node: LayoutNode, direction: Direction): number {
  return isRow(direction) ? node.marginLeft : node.marginTop;
}

function bound(node: LayoutNode, direction: Direction, value: number): number {
  const least = isRow(direction) ? node.minWidth : node.minHeight;
  return value < least ? least : value;
}

function extent(node: LayoutNode, direction: Direction): number {
  return isRow(direction) ? node.computedWidth : node.computedHeight;
}

function shownChildren(node: LayoutNode): LayoutNode[] {
  const shown: LayoutNode[] = [];
  for (const child of node.children) if (!child.hidden) shown.push(child);
  return shown;
}

function distribute(children: LayoutNode[], main: Direction, free: number, widthInside: number, heightInside: number): number {
  let weights = 0;
  for (const child of children) weights += free > 0 ? child.grow : child.shrink * extent(child, main);
  if (weights === 0) return free;
  let used = 0;
  for (const child of children) {
    const weight = free > 0 ? child.grow : child.shrink * extent(child, main);
    if (weight === 0) continue;
    const share = (free * weight) / weights;
    const target = bound(child, main, extent(child, main) + share);
    used += target - extent(child, main);
    if (isRow(main)) layoutNode(child, target, heightInside, target, undefined);
    else layoutNode(child, widthInside, target, undefined, target);
  }
  return free - used;
}

function layoutNode(node: LayoutNode, availableWidth: number, availableHeight: number, forcedWidth: number | undefined, forcedHeight: number | undefined): void {
  const width = forcedWidth ?? node.width;
  const height = forcedHeight ?? node.height;
  const askedWidth = width ?? availableWidth;
  const askedHeight = height ?? availableHeight;
  if (!node.isDirty && node.lastAvailableWidth === askedWidth && node.lastAvailableHeight === askedHeight) return;
  node.lastAvailableWidth = askedWidth;
  node.lastAvailableHeight = askedHeight;
  node.isDirty = false;

  if (node.measure !== null) {
    const measured = node.measure(askedWidth - leading(node, "row") - trailing(node, "row"));
    node.computedWidth = bound(node, "row", width ?? measured.width + leading(node, "row") + trailing(node, "row"));
    node.computedHeight = bound(node, "column", height ?? measured.height + leading(node, "column") + trailing(node, "column"));
    return;
  }

  const main = node.direction;
  const cross: Direction = isRow(main) ? "column" : "row";
  const widthInside = askedWidth - leading(node, "row") - trailing(node, "row");
  const heightInside = askedHeight - leading(node, "column") - trailing(node, "column");
  const children = shownChildren(node);

  let alongMain = 0;
  let acrossMost = 0;
  for (const child of children) {
    layoutNode(child, widthInside - marginOf(child, "row"), heightInside - marginOf(child, "column"), undefined, undefined);
    alongMain += extent(child, main) + marginOf(child, main);
    const across = extent(child, cross) + marginOf(child, cross);
    if (across > acrossMost) acrossMost = across;
  }
  if (children.length > 1) alongMain += node.gap * (children.length - 1);

  const mainIsFixed = isRow(main) ? true : height !== undefined;
  const mainInside = isRow(main) ? widthInside : heightInside;
  let free = mainIsFixed ? mainInside - alongMain : 0;
  if (free !== 0 && children.length > 0) {
    free = distribute(children, main, free, widthInside, heightInside);
    acrossMost = 0;
    for (const child of children) {
      const across = extent(child, cross) + marginOf(child, cross);
      if (across > acrossMost) acrossMost = across;
    }
  }

  const crossInside = isRow(main) ? (height === undefined ? acrossMost : heightInside) : widthInside;
  let at = leading(node, main);
  let between = node.gap;
  if (free > 0) {
    if (node.justify === "center") at += free / 2;
    else if (node.justify === "end") at += free;
    else if (node.justify === "between" && children.length > 1) between += free / (children.length - 1);
  }
  for (const child of children) {
    at += leadingMargin(child, main);
    let across = leading(node, cross) + leadingMargin(child, cross);
    const spare = crossInside - extent(child, cross) - marginOf(child, cross);
    if (node.align === "center") across += spare / 2;
    else if (node.align === "end") across += spare;
    else if (node.align === "stretch" && spare > 0 && child.measure === null) {
      if (isRow(main)) {
        if (child.height === undefined) layoutNode(child, extent(child, "row"), crossInside, extent(child, "row"), crossInside - marginOf(child, cross));
      } else if (child.width === undefined) layoutNode(child, crossInside, extent(child, "column"), crossInside - marginOf(child, cross), extent(child, "column"));
    }
    if (isRow(main)) {
      child.left = at;
      child.top = across;
    } else {
      child.top = at;
      child.left = across;
    }
    at += extent(child, main) + marginOf(child, main) - leadingMargin(child, main) + between;
  }

  const mainUsed = alongMain + leading(node, main) + trailing(node, main);
  const crossUsed = acrossMost + leading(node, cross) + trailing(node, cross);
  node.computedWidth = bound(node, "row", width ?? (isRow(main) ? askedWidth : askedWidth));
  node.computedHeight = bound(node, "column", height ?? (isRow(main) ? crossUsed : mainUsed));
}

function round(node: LayoutNode, absoluteLeft: number, absoluteTop: number): void {
  const left = absoluteLeft + node.left;
  const top = absoluteTop + node.top;
  const right = Math.round(left + node.computedWidth);
  const bottom = Math.round(top + node.computedHeight);
  node.left = Math.round(node.left);
  node.top = Math.round(node.top);
  node.computedWidth = right - Math.round(left);
  node.computedHeight = bottom - Math.round(top);
  for (const child of node.children) if (!child.hidden) round(child, left, top);
}

export function calculateLayout(root: LayoutNode, width: number): void {
  layoutNode(root, width, 0, width, undefined);
  round(root, 0, 0);
}
