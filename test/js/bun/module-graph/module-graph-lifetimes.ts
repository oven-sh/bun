// What the module graph tests ask of the garbage collector: whether something keeps an object alive.
import { generateHeapSnapshotForDebugging, jscDescribe } from "bun:jsc";

// bun-types does not declare it.
declare module "bun:jsc" {
  function generateHeapSnapshotForDebugging(): unknown;
}

/** A full collection from a timer callback, then a turn for FinalizationRegistry callbacks. Not
 *  from the caller's own continuation: that runs inside a microtask job, which still holds what it
 *  was given (the promise an `await` just resumed from, and through it the module that promise
 *  was fulfilled with). */
export function collect(): Promise<void> {
  return new Promise(resolve =>
    setTimeout(() => {
      Bun.gc(true);
      setTimeout(resolve, 0);
    }, 0),
  );
}

/** What these tests mean by "kept alive": a root reaches the cell through the heap. A collection
 *  alone cannot say that. JavaScriptCore also marks whatever a word on the native stack happens to
 *  point at, and a slot a live native frame never writes can hold a cell of an earlier callback's
 *  frames for as long as the loop re-enters that frame, so "it was not finalized" does not mean
 *  something holds it. The debugging heap snapshot has every edge and every root, and no entry for
 *  such words. A holder whose edges it lacked would read as "not kept alive": the first test of
 *  module-graph-gc.test.ts checks the holders that keep their values in a cell of their own. */
class Heap {
  readonly #className = new Map<number, string>();
  readonly #label = new Map<number, string>();
  readonly #idOfAddress = new Map<bigint, number>();
  /** For each cell a root reaches: the cell it was reached from and the edge, on a shortest path. */
  readonly #reachedFrom = new Map<number, [number, string] | undefined>();
  readonly #rootReason = new Map<number, string>();

  constructor() {
    const { nodes, edges, roots, nodeClassNames, edgeTypes, edgeNames, labels } =
      generateHeapSnapshotForDebugging() as any;
    for (let i = 0; i < nodes.length; i += 7) {
      this.#className.set(nodes[i], nodeClassNames[nodes[i + 2]]);
      if (labels[nodes[i + 4]]) this.#label.set(nodes[i], labels[nodes[i + 4]]);
      this.#idOfAddress.set(BigInt(nodes[i + 5]), nodes[i]);
    }
    const outgoing = new Map<number, [number, string][]>();
    for (let i = 0; i < edges.length; i += 4) {
      const type = edgeTypes[edges[i + 2]];
      const name = type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : edges[i + 3];
      let list = outgoing.get(edges[i]);
      if (!list) outgoing.set(edges[i], (list = []));
      list.push([edges[i + 1], type + ":" + name]);
    }
    const queue: number[] = [];
    for (let i = 0; i < roots.length; i += 3) {
      const reason = String(labels[roots[i + 1]] ?? roots[i + 1]);
      // What an output constraint appends (the listeners of a marked EventTarget, ...) is recorded
      // as a root, but only follows from its owner being marked, and the owner's edges say the same.
      if (this.#reachedFrom.has(roots[i]) || reason.includes("DOMGCOutput")) continue;
      this.#rootReason.set(roots[i], reason);
      this.#reachedFrom.set(roots[i], undefined);
      queue.push(roots[i]);
    }
    for (let i = 0; i < queue.length; i++)
      for (const [child, edge] of outgoing.get(queue[i]) ?? [])
        if (!this.#reachedFrom.has(child)) (this.#reachedFrom.set(child, [queue[i], edge]), queue.push(child));
  }

  /** The shortest path from a root to the cell at `address`, or undefined when no root reaches it. */
  pathTo(address: bigint): string | undefined {
    const id = this.#idOfAddress.get(address);
    if (id === undefined || !this.#reachedFrom.has(id)) return undefined;
    const describe = (cell: number) =>
      this.#className.get(cell) + (this.#label.has(cell) ? "(" + this.#label.get(cell) + ")" : "");
    const path: string[] = [];
    let at = id;
    for (let step = this.#reachedFrom.get(at); step; at = step[0], step = this.#reachedFrom.get(at))
      path.unshift(`-${step[1]}-> ${describe(at)}`);
    return [`root(${this.#rootReason.get(at)}) ${describe(at)}`, ...path].join(" ");
  }

  /** How many cells of each type a root reaches. */
  counts(types: string[]): Record<string, number> {
    const counts = Object.fromEntries(types.map(type => [type, 0]));
    for (const id of this.#reachedFrom.keys()) {
      const name = this.#className.get(id)!;
      if (name in counts) counts[name]++;
    }
    return counts;
  }
}

/** The heap as a timer callback sees it: with the caller suspended, so that what its frames hold
 *  is held through the heap, like everything else. The caller's continuation hangs off the promise
 *  returned here, which the timer's callback (on the stack while the snapshot is taken) would
 *  otherwise be the only thing to hold: `pendingHeap` holds it from this module's scope. */
let pendingHeap: Promise<Heap> | undefined;
export function heapFromTimer(): Promise<Heap> {
  return (pendingHeap = new Promise(resolve => setTimeout(() => resolve(new Heap()), 0)));
}

/** The address of the cell of `object`, for Heap.pathTo(). */
export const addressOf = (object: object) => BigInt(/0x[0-9a-fA-F]+/.exec(jscDescribe(object))![0]);

/** Lifetimes by name: `track` an object, then ask which are gone or still kept alive.
 *  A finalized object is gone, and that is all most runs need. One that is not finalized after a
 *  few collections is looked up in the heap (its cell is its own for as long as it is not
 *  collected): kept alive only if a root reaches it. A snapshot is slow on a debug build, so it
 *  is taken only then. */
export class Lifetimes {
  #finalized = new Set<string>();
  #registry = new FinalizationRegistry<string>(name => this.#finalized.add(name));
  #address = new Map<string, bigint>();
  track<T extends object>(name: string, object: T): T {
    this.#registry.register(object, name);
    this.#address.set(name, addressOf(object));
    return object;
  }
  #notFinalized(names: string[]): string[] {
    const untracked = names.filter(name => !this.#address.has(name));
    if (untracked.length) throw new Error("never tracked: " + untracked.join(", "));
    return names.filter(name => !this.#finalized.has(name));
  }
  /** Of `names`, those a root reaches, each with its path. */
  async #kept(names: string[]): Promise<Map<string, string>> {
    const heap = await heapFromTimer();
    const kept = new Map<string, string>();
    for (const name of this.#notFinalized(names)) {
      const path = heap.pathTo(this.#address.get(name)!);
      if (path !== undefined) kept.set(name, path);
    }
    return kept;
  }
  /** Collects until nothing keeps any of `names` alive (bounded); returns those still kept, with what keeps them. */
  async stillAlive(...names: string[]): Promise<string[]> {
    let waiting = this.#notFinalized(names);
    for (let i = 0; i < 100 && waiting.length; i++) {
      await collect();
      waiting = this.#notFinalized(waiting);
      // Not finalized after a few collections: from here on only what a root reaches is waited for.
      if (i === 4 && waiting.length) waiting = [...(await this.#kept(waiting)).keys()];
    }
    if (!waiting.length) return [];
    return [...(await this.#kept(waiting))].map(([name, path]) => `${name}: ${path}`);
  }
  /** Collects a few times; whether `name` survived all of them. Every caller expects it to, so
   *  this goes by finalization alone: a stack word can only make that pass, and asking the heap
   *  would cost each of them a snapshot. */
  async survives(name: string): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      await collect();
    }
    return this.#notFinalized([name]).length > 0;
  }
}
