import { createContext, type ReactNode } from "react";
import createReconciler from "react-reconciler";
import { DefaultEventPriority, NoEventPriority } from "react-reconciler/constants";
import { calculateLayout, LayoutNode, type Align, type Direction, type Justify, type Size } from "./layout";

export interface Styles {
  flexDirection?: Direction;
  alignItems?: Align;
  justifyContent?: Justify;
  flexGrow?: number;
  flexShrink?: number;
  gap?: number;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
  borderStyle?: "single" | "round";
  borderColor?: string;
  display?: "flex" | "none";
}

export interface TextStyles {
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface ElementNode {
  name: "terminal-root" | "terminal-box" | "terminal-text" | "terminal-span";
  parent: ElementNode | null;
  children: HostNode[];
  style: Styles;
  textStyles: TextStyles | undefined;
  attributes: Record<string, unknown>;
  layout: LayoutNode | null;
  wrapped: Wrapped | null;
}

interface Wrapped {
  availableWidth: number;
  lines: string[];
  widths: number[];
  width: number;
}

export interface TextNode {
  name: "#text";
  parent: ElementNode | null;
  value: string;
}

export type HostNode = ElementNode | TextNode;
type Props = Record<string, unknown>;

export const counts = { commits: 0, created: 0, updated: 0, texts: 0, painted: 0 };
export const options = { paints: true };

function applyStyles(node: LayoutNode, style: Styles): void {
  if ("flexDirection" in style) node.direction = style.flexDirection ?? "row";
  if ("alignItems" in style) node.align = style.alignItems ?? "stretch";
  if ("justifyContent" in style) node.justify = style.justifyContent ?? "start";
  if ("flexGrow" in style) node.grow = style.flexGrow ?? 0;
  if ("flexShrink" in style) node.shrink = style.flexShrink ?? 1;
  if ("gap" in style) node.gap = style.gap ?? 0;
  if ("width" in style) node.width = style.width;
  if ("height" in style) node.height = style.height;
  if ("minWidth" in style) node.minWidth = style.minWidth ?? 0;
  if ("minHeight" in style) node.minHeight = style.minHeight ?? 0;
  if ("padding" in style || "paddingX" in style || "paddingLeft" in style) node.paddingLeft = style.paddingLeft ?? style.paddingX ?? style.padding ?? 0;
  if ("padding" in style || "paddingX" in style || "paddingRight" in style) node.paddingRight = style.paddingRight ?? style.paddingX ?? style.padding ?? 0;
  if ("padding" in style || "paddingY" in style || "paddingTop" in style) node.paddingTop = style.paddingTop ?? style.paddingY ?? style.padding ?? 0;
  if ("padding" in style || "paddingY" in style || "paddingBottom" in style) node.paddingBottom = style.paddingBottom ?? style.paddingY ?? style.padding ?? 0;
  if ("margin" in style || "marginX" in style || "marginLeft" in style) node.marginLeft = style.marginLeft ?? style.marginX ?? style.margin ?? 0;
  if ("margin" in style || "marginX" in style || "marginRight" in style) node.marginRight = style.marginRight ?? style.marginX ?? style.margin ?? 0;
  if ("margin" in style || "marginY" in style || "marginTop" in style) node.marginTop = style.marginTop ?? style.marginY ?? style.margin ?? 0;
  if ("margin" in style || "marginY" in style || "marginBottom" in style) node.marginBottom = style.marginBottom ?? style.marginY ?? style.margin ?? 0;
  if ("borderStyle" in style) node.border = style.borderStyle ? 1 : 0;
  if ("display" in style) node.hidden = style.display === "none";
  node.markDirty();
}

function diff(before: Props | undefined, after: Props | undefined): Props | undefined {
  if (before === after) return undefined;
  if (!before) return after;
  const changed: Props = {};
  let isChanged = false;
  for (const key of Object.keys(before)) {
    if (!after || !Object.hasOwn(after, key)) {
      changed[key] = undefined;
      isChanged = true;
    }
  }
  if (after) {
    for (const key of Object.keys(after)) {
      if (after[key] !== before[key]) {
        changed[key] = after[key];
        isChanged = true;
      }
    }
  }
  return isChanged ? changed : undefined;
}

function textOf(node: ElementNode): string {
  let text = "";
  for (const child of node.children) text += child.name === "#text" ? child.value : paint(textOf(child), child.textStyles);
  return text;
}

const escape = "\x1b[";

function paint(text: string, styles: TextStyles | undefined): string {
  if (styles === undefined || text === "") return text;
  let open = "";
  if (styles.color) open += escape + "38;5;" + styles.color + "m";
  if (styles.background) open += escape + "48;5;" + styles.background + "m";
  if (styles.bold) open += escape + "1m";
  if (styles.dim) open += escape + "2m";
  if (styles.italic) open += escape + "3m";
  if (styles.underline) open += escape + "4m";
  if (styles.inverse) open += escape + "7m";
  return open === "" ? text : open + text + escape + "0m";
}

function widthOf(text: string): number {
  let width = 0;
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) === 27) {
      while (at < text.length && text.charCodeAt(at) !== 109) at++;
      continue;
    }
    width++;
  }
  return width;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (widthOf(paragraph) <= width) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    let used = 0;
    for (const word of paragraph.split(" ")) {
      const wide = widthOf(word);
      if (used > 0 && used + 1 + wide > width) {
        lines.push(line);
        line = word;
        used = wide;
      } else {
        line = used > 0 ? line + " " + word : word;
        used += used > 0 ? wide + 1 : wide;
      }
    }
    lines.push(line);
  }
  return lines;
}

function wrappedOf(node: ElementNode, availableWidth: number): Wrapped {
  const known = node.wrapped;
  if (known !== null && (known.availableWidth === availableWidth || (known.lines.length === 1 && known.width <= availableWidth))) return known;
  const lines = wrap(textOf(node), availableWidth);
  const widths = lines.map(widthOf);
  let width = 0;
  for (const each of widths) width = Math.max(width, each);
  return (node.wrapped = { availableWidth, lines: node.textStyles === undefined ? lines : lines.map(line => paint(line, node.textStyles)), widths, width });
}

function measureText(node: ElementNode, availableWidth: number): Size {
  const wrapped = wrappedOf(node, Math.max(1, availableWidth));
  return { width: wrapped.width, height: wrapped.lines.length };
}

function createElement(name: ElementNode["name"]): ElementNode {
  const node: ElementNode = { name, parent: null, children: [], style: {}, textStyles: undefined, attributes: {}, layout: name === "terminal-span" ? null : new LayoutNode(), wrapped: null };
  if (name === "terminal-text") node.layout!.measure = width => measureText(node, width);
  return node;
}

function markTextDirty(from: HostNode | null): void {
  for (let node = from; node !== null; node = node.parent) {
    if (node.name === "terminal-text") {
      node.wrapped = null;
      node.layout!.markDirty();
      return;
    }
  }
}

function layoutIndex(parent: ElementNode, before: HostNode): number {
  let at = 0;
  for (const child of parent.children) {
    if (child === before) break;
    if (child.name !== "#text" && child.layout !== null) at++;
  }
  return at;
}

function remove(parent: ElementNode, child: HostNode): void {
  const at = parent.children.indexOf(child);
  if (at >= 0) parent.children.splice(at, 1);
  child.parent = null;
  if (child.name !== "#text" && child.layout !== null) parent.layout?.remove(child.layout);
  else markTextDirty(parent);
}

function append(parent: ElementNode, child: HostNode): void {
  if (child.parent !== null) remove(child.parent, child);
  child.parent = parent;
  parent.children.push(child);
  if (child.name !== "#text" && child.layout !== null) parent.layout?.insert(child.layout, parent.layout.children.length);
  else markTextDirty(parent);
}

function insertBefore(parent: ElementNode, child: HostNode, before: HostNode): void {
  if (child.parent !== null) remove(child.parent, child);
  child.parent = parent;
  const at = parent.children.indexOf(before);
  if (child.name !== "#text" && child.layout !== null) parent.layout?.insert(child.layout, layoutIndex(parent, before));
  else markTextDirty(parent);
  parent.children.splice(at < 0 ? parent.children.length : at, 0, child);
}

class Output {
  rows: string[] = [];
  widths: number[] = [];

  write(left: number, top: number, lines: string[], widths: number[]): void {
    while (this.rows.length < top + lines.length) {
      this.rows.push("");
      this.widths.push(0);
    }
    for (let index = 0; index < lines.length; index++) {
      const row = top + index;
      const used = this.widths[row];
      this.rows[row] += used < left ? " ".repeat(left - used) + lines[index] : lines[index];
      this.widths[row] = Math.max(used, left) + widths[index];
    }
  }
}

const corners = { single: "++++", round: "()()" };

function render(node: ElementNode, output: Output, offsetLeft: number, offsetTop: number): void {
  const layout = node.layout!;
  if (layout.hidden) return;
  const left = offsetLeft + layout.left;
  const top = offsetTop + layout.top;
  if (node.name === "terminal-text") {
    const wrapped = wrappedOf(node, Math.max(1, layout.computedWidth));
    output.write(left, top, wrapped.lines, wrapped.widths);
    return;
  }
  const border = node.style.borderStyle;
  if (border) {
    const edge = "-".repeat(Math.max(0, layout.computedWidth - 2));
    output.write(left, top, [paint(corners[border][0] + edge + corners[border][1], { color: node.style.borderColor })], [layout.computedWidth]);
  }
  for (const child of node.children) if (child.name !== "#text" && child.layout !== null) render(child, output, left, top);
  if (border) {
    const edge = "-".repeat(Math.max(0, layout.computedWidth - 2));
    output.write(left, top + layout.computedHeight - 1, [paint(corners[border][2] + edge + corners[border][3], { color: node.style.borderColor })], [layout.computedWidth]);
  }
}

export class Screen {
  root = createElement("terminal-root");
  columns: number;
  frame: string[] = [];
  written = "";

  constructor(columns: number) {
    this.columns = columns;
    this.root.layout!.direction = "column";
  }

  paint(): void {
    calculateLayout(this.root.layout!, this.columns);
    const output = new Output();
    render(this.root, output, 0, 0);
    const next = output.rows;
    const before = this.frame;
    let patch = "";
    for (let row = 0; row < next.length; row++) {
      if (before[row] === next[row]) continue;
      patch += escape + (row + 1) + ";1H" + escape + "2K" + next[row];
    }
    if (before.length > next.length) patch += escape + (next.length + 1) + ";1H" + escape + "J";
    this.frame = next;
    this.written = patch;
    counts.painted += patch.length;
  }
}

let priority = NoEventPriority;
const screens = new Map<ElementNode, Screen>();

function setProps(node: ElementNode, props: Props): void {
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === "children") continue;
    if (key === "style") {
      node.style = value as Styles;
      if (node.layout !== null) applyStyles(node.layout, value as Styles);
    } else if (key === "textStyles") node.textStyles = value as TextStyles | undefined;
    else node.attributes[key] = value;
  }
}

const reconciler = createReconciler({
  getRootHostContext: () => ({ isInsideText: false }),
  getChildHostContext(parent: { isInsideText: boolean }, name: string) {
    const isInsideText = name === "terminal-text" || name === "terminal-span";
    return parent.isInsideText === isInsideText ? parent : { isInsideText };
  },
  prepareForCommit: () => null,
  preparePortalMount: () => null,
  clearContainer: () => false,
  resetAfterCommit(root: ElementNode) {
    counts.commits++;
    if (options.paints) screens.get(root)!.paint();
  },
  shouldSetTextContent: () => false,
  createInstance(name: ElementNode["name"], props: Props, _root: ElementNode, context: { isInsideText: boolean }): ElementNode {
    counts.created++;
    const node = createElement(name === "terminal-text" && context.isInsideText ? "terminal-span" : name);
    setProps(node, props);
    return node;
  },
  createTextInstance(value: string): TextNode {
    counts.created++;
    return { name: "#text", parent: null, value };
  },
  resetTextContent() {},
  hideTextInstance(node: TextNode) {
    node.value = "";
  },
  unhideTextInstance(node: TextNode, value: string) {
    node.value = value;
  },
  getPublicInstance: (instance: unknown) => instance,
  hideInstance(node: ElementNode) {
    if (node.layout !== null) node.layout.hidden = true;
  },
  unhideInstance(node: ElementNode) {
    if (node.layout !== null) node.layout.hidden = false;
  },
  appendInitialChild: append,
  appendChild: append,
  insertBefore,
  finalizeInitialChildren: () => false,
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  getInstanceFromNode: () => null,
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  appendChildToContainer: append,
  insertInContainerBefore: insertBefore,
  removeChildFromContainer: remove,
  removeChild: remove,
  commitUpdate(node: ElementNode, _name: string, before: Props, after: Props) {
    counts.updated++;
    const props = diff(before, after);
    if (props === undefined) return;
    const style = diff(before.style as Props | undefined, after.style as Props | undefined);
    for (const key of Object.keys(props)) {
      if (key === "children") continue;
      if (key === "style") node.style = (after.style ?? {}) as Styles;
      else if (key === "textStyles") {
        node.textStyles = after.textStyles as TextStyles | undefined;
        markTextDirty(node);
      } else node.attributes[key] = props[key];
    }
    if (style !== undefined && node.layout !== null) applyStyles(node.layout, style as Styles);
  },
  commitTextUpdate(node: TextNode, _before: string, value: string) {
    counts.texts++;
    node.value = value;
    markTextDirty(node);
  },
  setCurrentUpdatePriority(next: number) {
    priority = next;
  },
  getCurrentUpdatePriority: () => priority,
  resolveUpdatePriority: () => (priority !== NoEventPriority ? priority : DefaultEventPriority),
  maySuspendCommit: () => false,
  NotPendingTransition: undefined,
  HostTransitionContext: createContext(null) as never,
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
} as never) as unknown as {
  createContainer(root: ElementNode, tag: number, hydration: null, isStrict: boolean, override: null, prefix: string, uncaught: (error: unknown) => void, caught: (error: unknown) => void, recoverable: (error: unknown) => void, scheduled: () => void, transitions: null): object;
  updateContainerSync(element: ReactNode, container: object, parent: null, done: () => void): void;
  flushSyncWork(): void;
  flushPassiveEffects(): boolean;
};

export function mount(element: ReactNode, columns: number) {
  const screen = new Screen(columns);
  screens.set(screen.root, screen);
  const fail = (error: unknown) => {
    throw error;
  };
  const container = reconciler.createContainer(screen.root, 1, null, false, null, "", fail, fail, fail, () => {}, null);
  reconciler.updateContainerSync(element, container, null, () => {});
  const settle = () => {
    reconciler.flushSyncWork();
    reconciler.flushPassiveEffects();
    reconciler.flushSyncWork();
  };
  settle();
  return { screen, settle };
}
