// A small renderer. It keeps a tree of host nodes in step with a tree of elements, the way UI libraries do it:
// function components with hooks, two copies of every node (the one that is shown and the one in progress),
// and lanes: bit sets that say how urgent an update is and where in the tree work is waiting.
import type { int32 } from "bun";
import { addTask, runTasks } from "task-queue";

type Lane = int32;
type Lanes = int32;
type Flags = int32;
type Kind = int32;

export type Props = { [name: string]: unknown };
export type Child = Element | string | number | boolean | null | undefined | Child[];
export type Component = (props: any) => Child;
export interface Context<T> {
  is: "context";
  value: T;
}
export interface Memoized {
  is: "memo";
  component: Component;
}
export type ElementType = string | Component | Context<any> | Memoized;
export interface Element {
  type: ElementType;
  key: string | null;
  props: Props;
}

/** Whatever the host makes. The renderer only hands it back. */
export interface HostNode {}
export interface Host {
  createBox(name: string, props: Props): HostNode;
  createText(text: string): HostNode;
  append(parent: HostNode, child: HostNode): void;
  insertBefore(parent: HostNode, child: HostNode, before: HostNode): void;
  remove(parent: HostNode, child: HostNode): void;
  updateBox(box: HostNode, props: Props): void;
  updateText(node: HostNode, text: string): void;
  afterCommit(container: HostNode): void;
}
export interface Root {
  container: HostNode;
  shown: TreeNode;
  children: Child;
  pending: Lanes;
  scheduled: Lanes;
}
export interface Renderer {
  createRoot(container: HostNode): Root;
  render(root: Root, children: Child): void;
  /** Runs the tasks of the package task-queue, where the renderer puts its work, until nothing is pending. */
  flush(): void;
  /** Updates made by `run` wait until everything more urgent is on the screen. */
  later(run: () => void): void;
}

interface TreeNode {
  kind: Kind;
  key: string | null;
  type: ElementType | null;
  hostNode: HostNode | null;
  parent: TreeNode | null;
  child: TreeNode | null;
  next: TreeNode | null;
  index: number;
  newProps: Props | string | null;
  props: Props | string | null;
  hooks: Hook | null;
  effects: Effect | null;
  reads: ContextRead | null;
  flags: Flags;
  flagsBelow: Flags;
  removed: TreeNode[] | null;
  lanes: Lanes;
  lanesBelow: Lanes;
  twin: TreeNode | null;
}
type TreeNodeConstructor = new (
  kind: Kind,
  newProps: Props | string | null,
  key: string | null,
  lanes: Lanes,
) => TreeNode;

type Reducer = (state: any, action: any) => unknown;
type Cleanup = (() => void) | void;
interface Hook {
  state: unknown;
  queue: Queue | null;
  next: Hook | null;
}
interface Queue {
  last: Update | null;
  dispatch: (action: unknown) => void;
}
interface Update {
  lane: Lane;
  action: unknown;
  next: Update | null;
}
interface Memo {
  value: unknown;
  inputs: unknown[];
}
interface Effect {
  flags: Flags;
  run: () => Cleanup;
  cleanup: Cleanup;
  inputs: unknown[] | null;
  next: Effect | null;
}
interface ContextRead {
  context: Context<unknown>;
  next: ContextRead | null;
}
interface Hooks {
  useReducer(reducer: Reducer, initial: unknown): [unknown, (action: unknown) => void];
  useMemo(make: () => unknown, inputs: unknown[]): unknown;
  useEffect(kind: Flags, run: () => Cleanup, inputs: unknown[] | null): void;
  useContext(context: Context<unknown>): unknown;
}

const isRoot = 1,
  isComponent = 2,
  isMemo = 3,
  isProvider = 4,
  isBox = 5,
  isText = 6;

const placed = 1,
  changed = 2,
  hasRemovals = 4,
  hasLayoutEffects = 8,
  hasEffects = 16,
  changesHost = placed | changed | hasRemovals;

const mustRun = 1,
  beforePaint = 2,
  afterPaint = 4;

const normalLane = 1,
  firstLaterLane = 2,
  laterLanes = 0b111110;

let hooks: Hooks | null = null;

export function h(type: ElementType, config: Props | null, ...children: Child[]): Element {
  const props: Props = {};
  let key: string | null = null;
  if (config !== null)
    for (const name in config) {
      if (name === "key") key = String(config.key);
      else props[name] = config[name];
    }
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return { type, key, props };
}
export const createContext = <T>(value: T): Context<T> => ({ is: "context", value });
export const memo = (component: Component): Memoized => ({ is: "memo", component });

const replaceState: Reducer = (state, action) => (typeof action === "function" ? action(state) : action);
export function useState<S>(initial: S): [S, (next: S | ((before: S) => S)) => void] {
  return hooks!.useReducer(replaceState, initial) as [S, (next: S | ((before: S) => S)) => void];
}
export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void] {
  return hooks!.useReducer(reducer, initial) as [S, (action: A) => void];
}
export const useMemo = <T>(make: () => T, inputs: unknown[]): T => hooks!.useMemo(make, inputs) as T;
export const useCallback = <T>(callback: T, inputs: unknown[]): T => hooks!.useMemo(() => callback, inputs) as T;
export const useRef = <T>(initial: T): { current: T } =>
  hooks!.useMemo(() => ({ current: initial }), []) as { current: T };
export const useEffect = (run: () => Cleanup, inputs?: unknown[]): void =>
  hooks!.useEffect(afterPaint, run, inputs ?? null);
export const useLayoutEffect = (run: () => Cleanup, inputs?: unknown[]): void =>
  hooks!.useEffect(beforePaint, run, inputs ?? null);
export const useContext = <T>(context: Context<T>): T => hooks!.useContext(context) as T;

function hasSameInputs(before: unknown[] | null, now: unknown[] | null): boolean {
  if (before === null || now === null || before.length !== now.length) return false;
  for (let at = 0; at < now.length; at++) if (!Object.is(before[at], now[at])) return false;
  return true;
}
function hasSameProps(before: Props, now: Props): boolean {
  const names = Object.keys(now);
  if (names.length !== Object.keys(before).length) return false;
  for (const name of names) if (!Object.hasOwn(before, name) || !Object.is(before[name], now[name])) return false;
  return true;
}

export function createRenderer(host: Host): Renderer {
  const valuesAbove: unknown[] = [];
  let renderLanes: Lanes = 0;
  let laneOfUpdates: Lane = normalLane;
  let nextLaterLane: Lane = firstLaterLane;
  let rendering: TreeNode | null = null;
  let shownHook: Hook | null = null;
  let lastHook: Hook | null = null;

  function TreeNode(this: TreeNode, kind: Kind, newProps: Props | string | null, key: string | null, lanes: Lanes) {
    this.kind = kind;
    this.key = key;
    this.type = null;
    this.hostNode = null;
    this.parent = this.child = this.next = null;
    this.index = 0;
    this.newProps = newProps;
    this.props = null;
    this.hooks = null;
    this.effects = null;
    this.reads = null;
    this.flags = this.flagsBelow = 0;
    this.removed = null;
    this.lanes = lanes;
    this.lanesBelow = 0;
    this.twin = null;
  }
  /** A new node has work in the lanes of the render that makes it. */
  function createNode(kind: Kind, newProps: Props | string | null, key: string | null, lanes: Lanes): TreeNode {
    return new (TreeNode as unknown as TreeNodeConstructor)(kind, newProps, key, lanes);
  }
  function createNodeOf(element: Element): TreeNode {
    const type = element.type;
    const kind =
      typeof type === "string"
        ? isBox
        : typeof type === "function"
          ? isComponent
          : type.is === "memo"
            ? isMemo
            : isProvider;
    const node = createNode(kind, element.props, element.key, renderLanes);
    node.type = type;
    return node;
  }
  function copyToWorkOn(shown: TreeNode, newProps: Props | string | null): TreeNode {
    let copy = shown.twin;
    if (copy === null) {
      copy = createNode(shown.kind, newProps, shown.key, shown.lanes);
      copy.type = shown.type;
      copy.hostNode = shown.hostNode;
      copy.twin = shown;
      shown.twin = copy;
    } else {
      copy.newProps = newProps;
      copy.flags = copy.flagsBelow = 0;
      copy.removed = null;
    }
    copy.lanes = shown.lanes;
    copy.lanesBelow = shown.lanesBelow;
    copy.child = shown.child;
    copy.next = shown.next;
    copy.index = shown.index;
    copy.props = shown.props;
    copy.hooks = shown.hooks;
    copy.effects = shown.effects;
    copy.reads = shown.reads;
    return copy;
  }

  function markLane(from: TreeNode, lane: Lane): Root | null {
    from.lanes |= lane;
    if (from.twin !== null) from.twin.lanes |= lane;
    let node = from;
    for (let parent = node.parent; parent !== null; parent = node.parent) {
      parent.lanesBelow |= lane;
      if (parent.twin !== null) parent.twin.lanesBelow |= lane;
      node = parent;
    }
    return node.kind === isRoot ? (node.hostNode as Root) : null;
  }
  function schedule(node: TreeNode, lane: Lane) {
    const root = markLane(node, lane);
    if (root === null) return;
    root.pending |= lane;
    if ((root.scheduled & lane) !== 0) return;
    root.scheduled |= lane;
    addTask(lane, (lane: Lane) => work(root, lane));
  }

  function addHook(state: unknown, queue: Queue | null): Hook {
    const hook: Hook = { state, queue, next: null };
    if (lastHook === null) rendering!.hooks = hook;
    else lastHook.next = hook;
    return (lastHook = hook);
  }
  function copyNextHook(): Hook {
    shownHook = shownHook === null ? rendering!.twin!.hooks : shownHook.next;
    return addHook(shownHook!.state, shownHook!.queue);
  }
  function enqueue(queue: Queue, update: Update) {
    if (queue.last === null) update.next = update;
    else {
      update.next = queue.last.next;
      queue.last.next = update;
    }
    queue.last = update;
  }
  function addEffect(flags: Flags, run: () => Cleanup, cleanup: Cleanup, inputs: unknown[] | null): Effect {
    const node = rendering!;
    const effect: Effect = { flags, run, cleanup, inputs, next: null };
    let last = node.effects;
    if (last === null) node.effects = effect;
    else {
      while (last.next !== null) last = last.next;
      last.next = effect;
    }
    if ((flags & mustRun) !== 0) node.flags |= (flags & beforePaint) !== 0 ? hasLayoutEffects : hasEffects;
    return effect;
  }
  function readContext(context: Context<unknown>): unknown {
    rendering!.reads = { context, next: rendering!.reads };
    return context.value;
  }

  const hooksOfFirstRender: Hooks = {
    useReducer(_reducer, initial) {
      const node = rendering!;
      const queue: Queue = {
        last: null,
        dispatch(action) {
          const update: Update = { lane: laneOfUpdates, action, next: null };
          enqueue(queue, update);
          schedule(node, update.lane);
        },
      };
      addHook(initial, queue);
      return [initial, queue.dispatch];
    },
    useMemo(make, inputs) {
      const memo: Memo = { value: make(), inputs };
      addHook(memo, null);
      return memo.value;
    },
    useEffect(kind, run, inputs) {
      addHook(addEffect(kind | mustRun, run, undefined, inputs), null);
    },
    useContext: readContext,
  };
  const hooksOfLaterRenders: Hooks = {
    useReducer(reducer) {
      const hook = copyNextHook();
      const queue = hook.queue!;
      const last = queue.last;
      if (last !== null) {
        queue.last = null;
        let update = last.next;
        last.next = null;
        while (update !== null) {
          const following: Update | null = update.next;
          if ((renderLanes & update.lane) === update.lane) hook.state = reducer(hook.state, update.action);
          else {
            // It waits for a render of its own lane.
            enqueue(queue, update);
            rendering!.lanes |= update.lane;
          }
          update = following;
        }
      }
      return [hook.state, queue.dispatch];
    },
    useMemo(make, inputs) {
      const hook = copyNextHook();
      const before = hook.state as Memo;
      if (hasSameInputs(before.inputs, inputs)) return before.value;
      const memo: Memo = { value: make(), inputs };
      hook.state = memo;
      return memo.value;
    },
    useEffect(kind, run, inputs) {
      const hook = copyNextHook();
      const before = hook.state as Effect;
      hook.state = addEffect(hasSameInputs(before.inputs, inputs) ? kind : kind | mustRun, run, before.cleanup, inputs);
    },
    useContext: readContext,
  };

  function renderComponent(node: TreeNode, component: Component): Child {
    rendering = node;
    shownHook = lastHook = null;
    node.hooks = null;
    node.effects = null;
    node.reads = null;
    hooks = node.twin === null ? hooksOfFirstRender : hooksOfLaterRenders;
    const children = component(node.newProps);
    hooks = null;
    rendering = null;
    return children;
  }

  type Item = Element | string | null;
  function flatten(children: Child, into: Item[]) {
    if (Array.isArray(children)) for (const child of children) flatten(child, into);
    else if (typeof children === "string") into.push(children);
    else if (typeof children === "number") into.push("" + children);
    else if (children === null || children === undefined || typeof children === "boolean") into.push(null);
    else into.push(children);
  }
  const keyOf = (item: Element | string) => (typeof item === "string" ? null : item.key);
  function copyOrCreate(match: TreeNode | null, item: Element | string): TreeNode {
    if (typeof item === "string")
      return match !== null && match.kind === isText
        ? copyToWorkOn(match, item)
        : createNode(isText, item, null, renderLanes);
    return match !== null && match.type === item.type ? copyToWorkOn(match, item.props) : createNodeOf(item);
  }
  function remove(parent: TreeNode, node: TreeNode) {
    if (parent.removed === null) parent.removed = [node];
    else parent.removed.push(node);
    parent.flags |= hasRemovals;
  }

  function reconcile(parent: TreeNode, children: Child): TreeNode | null {
    const items: Item[] = [];
    flatten(children, items);
    // The children of a new node reach the host together with it.
    const tracksChanges = parent.twin !== null;
    let first: TreeNode | null = null;
    let last: TreeNode | null = null;
    let shown = parent.child;
    let rest: Map<string | number, TreeNode> | null = null;
    let furthestKept = 0;
    for (let at = 0; at < items.length; at++) {
      const item = items[at];
      let match: TreeNode | null = null;
      // In step for as long as the keys agree, by key from there on.
      if (shown !== null) {
        if (item === null ? shown.index !== at : shown.index === at && shown.key === keyOf(item)) {
          if (item === null) continue;
          match = shown;
          shown = shown.next;
        } else {
          rest = new Map();
          for (; shown !== null; shown = shown.next) rest.set(shown.key ?? shown.index, shown);
        }
      }
      if (item === null) continue;
      if (rest !== null) match = rest.get(keyOf(item) ?? at) ?? null;
      const node = copyOrCreate(match, item);
      const isKept = node.twin !== null;
      if (isKept && rest !== null) rest.delete(keyOf(item) ?? at);
      if (tracksChanges) {
        if (!isKept && match !== null && rest === null) remove(parent, match);
        if (isKept && match!.index >= furthestKept) furthestKept = match!.index;
        else node.flags |= placed;
      }
      node.index = at;
      node.parent = parent;
      if (last === null) first = node;
      else last.next = node;
      last = node;
    }
    if (tracksChanges) {
      for (; shown !== null; shown = shown.next) remove(parent, shown);
      if (rest !== null) for (const node of rest.values()) remove(parent, node);
    }
    if (last !== null) last.next = null;
    return (parent.child = first);
  }

  function markReaders(first: TreeNode | null, context: Context<unknown>): boolean {
    let isReadHere = false;
    for (let node = first; node !== null; node = node.next) {
      let reads = false;
      for (let read = node.reads; read !== null && !reads; read = read.next) reads = read.context === context;
      if (reads) {
        node.lanes |= renderLanes;
        if (node.twin !== null) node.twin.lanes |= renderLanes;
      }
      const isReadBelow = !(node.kind === isProvider && node.type === context) && markReaders(node.child, context);
      if (isReadBelow) {
        node.lanesBelow |= renderLanes;
        if (node.twin !== null) node.twin.lanesBelow |= renderLanes;
      }
      isReadHere ||= reads || isReadBelow;
    }
    return isReadHere;
  }

  function skip(node: TreeNode): TreeNode | null {
    if ((node.lanesBelow & renderLanes) === 0) return null;
    let shown = node.child;
    if (shown === null) return null;
    let copy = (node.child = copyToWorkOn(shown, shown.props));
    copy.parent = node;
    for (shown = shown.next; shown !== null; shown = shown.next) {
      copy = copy.next = copyToWorkOn(shown, shown.props);
      copy.parent = node;
    }
    return node.child;
  }

  function begin(node: TreeNode): TreeNode | null {
    const shown = node.twin;
    const hasUpdate = (node.lanes & renderLanes) !== 0;
    if (node.kind === isProvider) {
      const context = node.type as Context<unknown>;
      valuesAbove.push(context.value);
      context.value = (node.newProps as Props).value;
    }
    if (shown !== null && !hasUpdate) {
      if (shown.props === node.newProps) return skip(node);
      if (node.kind === isMemo && hasSameProps(shown.props as Props, node.newProps as Props)) return skip(node);
    }
    node.lanes = 0;
    switch (node.kind) {
      case isRoot:
        return reconcile(node, (node.hostNode as Root).children);
      case isComponent:
        return reconcile(node, renderComponent(node, node.type as Component));
      case isMemo:
        return reconcile(node, renderComponent(node, (node.type as Memoized).component));
      case isProvider: {
        const context = node.type as Context<unknown>;
        if (shown !== null && !Object.is((shown.props as Props).value, context.value)) markReaders(node.child, context);
        return reconcile(node, (node.newProps as Props).children as Child);
      }
      case isBox:
        return reconcile(node, (node.newProps as Props).children as Child);
      default:
        return null;
    }
  }

  function appendHostNodes(box: HostNode, parent: TreeNode) {
    for (let node = parent.child; node !== null; node = node.next) {
      if (node.kind === isBox || node.kind === isText) host.append(box, node.hostNode!);
      else appendHostNodes(box, node);
    }
  }
  function complete(node: TreeNode) {
    const shown = node.twin;
    if (node.kind === isBox) {
      if (shown === null) {
        node.hostNode = host.createBox(node.type as string, node.newProps as Props);
        appendHostNodes(node.hostNode, node);
      } else if (shown.props !== node.newProps) node.flags |= changed;
    } else if (node.kind === isText) {
      if (shown === null) node.hostNode = host.createText(node.newProps as string);
      else if (shown.props !== node.newProps) node.flags |= changed;
    } else if (node.kind === isProvider) (node.type as Context<unknown>).value = valuesAbove.pop();

    let lanes: Lanes = 0,
      flags: Flags = 0;
    for (let child = node.child; child !== null; child = child.next) {
      lanes |= child.lanes | child.lanesBelow;
      flags |= child.flags | child.flagsBelow;
      child.parent = node;
    }
    node.lanesBelow = lanes;
    // What was skipped still has the flags of the commit before.
    if (shown === null || shown.child !== node.child) node.flagsBelow |= flags;
  }
  function renderTree(root: Root, lanes: Lanes): TreeNode {
    renderLanes = lanes;
    const top = copyToWorkOn(root.shown, null);
    let node: TreeNode | null = top;
    while (node !== null) {
      const child = begin(node);
      node.props = node.newProps;
      if (child !== null) {
        node = child;
        continue;
      }
      let done: TreeNode | null = node;
      node = null;
      for (; done !== null; done = done.parent) {
        complete(done);
        if (done.next !== null) {
          node = done.next;
          break;
        }
      }
    }
    return top;
  }

  const isHostParent = (node: TreeNode) => node.kind === isBox || node.kind === isRoot;
  const hostNodeOfParent = (node: TreeNode) =>
    node.kind === isRoot ? (node.hostNode as Root).container : node.hostNode!;
  function findHostParent(from: TreeNode): HostNode {
    let node = from;
    while (!isHostParent(node)) node = node.parent!;
    return hostNodeOfParent(node);
  }
  function findHostNodeAfter(from: TreeNode): HostNode | null {
    let node = from;
    search: for (;;) {
      while (node.next === null) {
        if (node.parent === null || isHostParent(node.parent)) return null;
        node = node.parent;
      }
      node = node.next;
      while (node.kind !== isBox && node.kind !== isText) {
        if ((node.flags & placed) !== 0 || node.child === null) continue search;
        node = node.child;
      }
      if ((node.flags & placed) === 0) return node.hostNode;
    }
  }
  function place(node: TreeNode, parent: HostNode, before: HostNode | null) {
    if (node.kind === isBox || node.kind === isText) {
      if (before === null) host.append(parent, node.hostNode!);
      else host.insertBefore(parent, node.hostNode!, before);
    } else for (let child = node.child; child !== null; child = child.next) place(child, parent, before);
  }
  function unmount(node: TreeNode, hostParent: HostNode | null) {
    let parentOfChildren = hostParent;
    if (node.kind === isBox || node.kind === isText) {
      if (hostParent !== null) host.remove(hostParent, node.hostNode!);
      parentOfChildren = null;
    }
    for (let effect = node.effects; effect !== null; effect = effect.next)
      if (typeof effect.cleanup === "function") effect.cleanup();
    for (let child = node.child; child !== null; child = child.next) unmount(child, parentOfChildren);
  }
  function commitHostChanges(node: TreeNode) {
    if (node.removed !== null) {
      const hostParent = findHostParent(node);
      for (const gone of node.removed) {
        unmount(gone, hostParent);
        gone.parent = null;
        if (gone.twin !== null) gone.twin.parent = null;
      }
    }
    if ((node.flagsBelow & changesHost) !== 0)
      for (let child = node.child; child !== null; child = child.next) commitHostChanges(child);
    if ((node.flags & placed) !== 0) {
      place(node, findHostParent(node.parent!), findHostNodeAfter(node));
      node.flags &= ~placed;
    }
    if ((node.flags & changed) !== 0) {
      if (node.kind === isBox) host.updateBox(node.hostNode!, node.props as Props);
      else host.updateText(node.hostNode!, node.props as string);
    }
  }
  function runEffects(parent: TreeNode, kind: Flags, flagOfNode: Flags, starts: boolean) {
    for (let node = parent.child; node !== null; node = node.next) {
      if ((node.flagsBelow & flagOfNode) !== 0) runEffects(node, kind, flagOfNode, starts);
      if ((node.flags & flagOfNode) === 0) continue;
      for (let effect = node.effects; effect !== null; effect = effect.next) {
        if ((effect.flags & (kind | mustRun)) !== (kind | mustRun)) continue;
        if (starts) effect.cleanup = effect.run();
        else if (typeof effect.cleanup === "function") effect.cleanup();
      }
    }
  }
  function work(root: Root, lane: Lane) {
    root.scheduled &= ~lane;
    // What can wait is rendered together.
    const lanes: Lanes = (lane & laterLanes) !== 0 ? root.pending & laterLanes : lane;
    if ((root.pending & lanes) !== 0) commit(root, renderTree(root, lanes));
  }
  function commit(root: Root, top: TreeNode) {
    root.pending = (root.pending & ~renderLanes) | top.lanes | top.lanesBelow;
    commitHostChanges(top);
    root.shown = top;
    if ((top.flagsBelow & hasLayoutEffects) !== 0) {
      runEffects(top, beforePaint, hasLayoutEffects, false);
      runEffects(top, beforePaint, hasLayoutEffects, true);
    }
    host.afterCommit(root.container);
    if ((top.flagsBelow & hasEffects) !== 0) {
      runEffects(top, afterPaint, hasEffects, false);
      runEffects(top, afterPaint, hasEffects, true);
    }
  }

  return {
    createRoot(container) {
      const shown = createNode(isRoot, null, null, 0);
      const root: Root = { container, shown, children: null, pending: 0, scheduled: 0 };
      shown.hostNode = root;
      return root;
    },
    render(root, children) {
      root.children = children;
      schedule(root.shown, laneOfUpdates);
    },
    flush: runTasks,
    later(run) {
      const before = laneOfUpdates;
      laneOfUpdates = nextLaterLane;
      const following: Lane = (nextLaterLane << 1) & laterLanes;
      nextLaterLane = following !== 0 ? following : firstLaterLane;
      try {
        run();
      } finally {
        laneOfUpdates = before;
      }
    },
  };
}
