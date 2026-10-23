// @bun
//@ requireOptions("--useDollarVM=true")
// From JSTests/stress/weakmap-ephemeron-chain.js and resources/weakmap-ephemeron-chains.js in
// oven-sh/WebKit, with the shapes inlined.
// The collector resolves a chain of WeakMap entries through a key-to-values table once the
// chain has cost it Options::ephemeronFixpointIterations() marking rounds. Every shape must
// keep all of its values alive in a bounded number of marking rounds, and the table must not
// keep the values of dead keys alive. The last block checks the time it takes: two full
// collections of a 40,000 entry chain took about 18 seconds before the table, and take tens
// of milliseconds with it.

// Chains of WeakMap entries, where each value is (or leads to) the key of the next entry.
// Each builder returns { head, roots, walk }: walk(node) gives the next node of the chain, and
// the chain is reachable only through `head` and the WeakMaps in `roots`.
function ephemeronChainShapes(count) {
  function buildLateMaps(makeValue, keyOf) {
    const first = new WeakMap();
    const head = { id: 0 };
    let map = first;
    let key = head;
    for (let id = 1; id <= count; id++) {
      const nextMap = new WeakMap();
      const nextKey = { id };
      map.set(key, makeValue(nextMap, nextKey));
      map = nextMap;
      key = nextKey;
    }
    return {
      head: { node: head, map: first },
      roots: [],
      walk: ({ node, map }) => {
        const value = map.get(node);
        return value ? { node: keyOf(value), map: value.map } : undefined;
      },
    };
  }

  return {
    direct() {
      const map = new WeakMap();
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        map.set(tail, next);
        tail = next;
      }
      return { head, roots: [map], walk: node => map.get(node) };
    },
    // Allocated in the opposite order of the walk: the last node allocated is the root.
    reverse() {
      const map = new WeakMap();
      const nodes = [];
      for (let id = 0; id <= count; id++) nodes.push({ id });
      for (let id = count; id > 0; id--) map.set(nodes[id], nodes[id - 1]);
      return { head: nodes[count], roots: [map], walk: node => map.get(node) };
    },
    twoMaps() {
      const a = new WeakMap();
      const b = new WeakMap();
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        (id % 2 ? a : b).set(tail, next);
        tail = next;
      }
      return { head, roots: [a, b], walk: node => a.get(node) ?? b.get(node) };
    },
    manyMaps() {
      const maps = [];
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        const map = new WeakMap();
        map.set(tail, next);
        maps.push(map);
        tail = next;
      }
      return { head, roots: maps, walk: node => maps[node.id]?.get(node) };
    },
    // The maps in the opposite order of the walk, so that a scan of the maps in allocation
    // order gets one link per scan.
    manyMapsReverse() {
      const nodes = [];
      const maps = [];
      for (let id = 0; id <= count; id++) {
        nodes.push({ id });
        maps.push(new WeakMap());
      }
      for (let id = count; id > 0; id--) maps[id].set(nodes[id], nodes[id - 1]);
      return { head: nodes[count], roots: maps, walk: node => maps[node.id]?.get(node) };
    },
    // The same, and each map also holds entries for live keys that are not in the chain.
    manyMapsWide() {
      const nodes = [];
      const maps = [];
      const others = [];
      for (let id = 0; id <= count; id++) {
        nodes.push({ id });
        const map = new WeakMap();
        for (let i = 0; i < 20; i++) {
          const other = { id, i };
          others.push(other);
          map.set(other, { i });
        }
        maps.push(map);
      }
      for (let id = count; id > 0; id--) maps[id].set(nodes[id], nodes[id - 1]);
      return { head: nodes[count], roots: [maps, others], walk: node => maps[node.id]?.get(node) };
    },
    wrapper() {
      const map = new WeakMap();
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        map.set(tail, { next });
        tail = next;
      }
      return { head, roots: [map], walk: node => map.get(node)?.next };
    },
    closure() {
      const map = new WeakMap();
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        map.set(tail, () => next);
        tail = next;
      }
      return { head, roots: [map], walk: node => map.get(node)?.() };
    },
    prototype() {
      const map = new WeakMap();
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        map.set(tail, Object.create(next));
        tail = next;
      }
      return {
        head,
        roots: [map],
        walk: node => {
          const value = map.get(node);
          return value ? Object.getPrototypeOf(value) : undefined;
        },
      };
    },
    // Each map is reachable only through the value of the map before it. The three
    // variants differ in whether the collector meets the next map before or after the next
    // key: the key comes first, the map comes first, or the key sits two objects deeper.
    lateMaps() {
      return buildLateMaps(
        (nextMap, nextKey) => ({ key: nextKey, map: nextMap }),
        value => value.key,
      );
    },
    lateMapsMapFirst() {
      return buildLateMaps(
        (nextMap, nextKey) => ({ map: nextMap, key: nextKey }),
        value => value.key,
      );
    },
    lateMapsKeyDeeper() {
      return buildLateMaps(
        (nextMap, nextKey) => ({ map: nextMap, holder: { key: nextKey } }),
        value => value.holder.key,
      );
    },
    // Each map also holds entries for keys that die, so it grows through several rehashes.
    lateMapsWide() {
      return buildLateMaps(
        (nextMap, nextKey) => {
          for (let i = 0; i < 20; i++) nextMap.set({ junk: i }, { junk: i });
          return { map: nextMap, key: nextKey };
        },
        value => value.key,
      );
    },
    // Each key is in two maps. The chain goes through the second one.
    twoEntriesPerKey() {
      const side = new WeakMap();
      const chain = new WeakMap();
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        side.set(tail, { side: id });
        chain.set(tail, next);
        tail = next;
      }
      return { head, roots: [side, chain], walk: node => (side.get(node) ? chain.get(node) : undefined) };
    },
    // A key in many maps, each reachable only through the chain.
    sharedKeyManyMaps() {
      const shared = { shared: true };
      const chain = new WeakMap();
      const head = { id: 0 };
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = { id };
        const side = new WeakMap();
        side.set(shared, { id });
        chain.set(tail, { next, side });
        tail = next;
      }
      return { head, roots: [chain, shared], walk: node => chain.get(node)?.next };
    },
    symbolKeys() {
      const map = new WeakMap();
      const head = Symbol("0");
      let tail = head;
      for (let id = 1; id <= count; id++) {
        const next = Symbol(String(id));
        map.set(tail, next);
        tail = next;
      }
      return { head, roots: [map], walk: node => map.get(node) };
    },
  };
}

function shouldBe(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const count = 2000;
// Without the table a chain of this length takes about count / 2 rounds. With it, a round
// per threshold step, a few for the rest, and with several markers a hand-off or two per
// map that marking reaches late.
const roundsBound = 100;

function checkReachable(name, fixture) {
  let visited = 0;
  for (let node = fixture.head; node; node = fixture.walk(node)) visited++;
  shouldBe(visited, count + 1, `${name}: nodes reachable after GC`);
}

// $vm is compiled into some builds of Bun only (the harness asks for it above). Where it is
// not, the time bound at the end of this file is the check.
function checkRounds(name) {
  if (typeof $vm === "undefined") return;
  const rounds = $vm.fixpointRoundsOfLastGC();
  if (rounds > roundsBound) throw new Error(`${name}: the last collection ran ${rounds} marking rounds`);
}

for (const [name, build] of Object.entries(ephemeronChainShapes(count))) {
  // A chain that has never been through a full collection: every key is new.
  let fixture = build();
  globalThis.fixture = fixture;
  edenGC();
  checkRounds(`${name} (eden)`);
  edenGC();
  checkReachable(`${name} (eden)`, fixture);
  fullGC();
  checkRounds(`${name} (full)`);
  fullGC();
  checkRounds(`${name} (second full)`);
  edenGC();
  checkReachable(`${name} (full)`, fixture);
  fixture = null;
  globalThis.fixture = null;
}

// A map that marking reaches only through the last link of a chain, while the program deletes
// some of its entries, replaces others and adds a few between collections.
{
  const chain = new WeakMap();
  const head = { id: 0 };
  let tail = head;
  for (let id = 1; id <= count; id++) {
    const next = { id };
    chain.set(tail, next);
    tail = next;
  }
  const late = new WeakMap();
  const keys = [];
  for (let i = 0; i < 200; i++) {
    const key = { i };
    keys.push(key);
    late.set(key, { i });
  }
  chain.set(tail, { late, keys });
  tail = null;
  globalThis.fixture = { head, chain };
  const deleted = new Set();
  for (let round = 0; round < 3; round++) {
    fullGC();
    checkRounds(`mutated late map (round ${round})`);
    let node = head;
    while (chain.get(node)?.late === undefined) {
      node = chain.get(node);
      shouldBe(node !== undefined, true, `mutated late map: chain intact after round ${round}`);
    }
    const { late: map, keys: held } = chain.get(node);
    for (let i = 0; i < held.length; i++) {
      shouldBe(map.has(held[i]), !deleted.has(held[i]), `mutated late map: entry ${i} after round ${round}`);
      if (i % 7 === round) (deleted.add(held[i]), map.delete(held[i]));
      else if (i % 7 === round + 1) map.set(held[i], { replaced: i });
    }
    for (let i = 0; i < 20; i++) {
      const key = { added: round, i };
      held.push(key);
      map.set(key, { added: i });
    }
  }
  globalThis.fixture = null;
}

// Half of the chain survived a full collection, the other half is new.
{
  const map = new WeakMap();
  const head = { id: 0 };
  let tail = head;
  for (let id = 1; id <= count / 2; id++) {
    const next = { id };
    map.set(tail, next);
    tail = next;
  }
  globalThis.fixture = { head, map };
  fullGC();
  for (let id = count / 2 + 1; id <= count; id++) {
    const next = { id };
    map.set(tail, next);
    tail = next;
  }
  tail = null;
  edenGC();
  edenGC();
  checkReachable("mixed generations (eden)", { head, walk: node => map.get(node) });
  fullGC();
  checkReachable("mixed generations (full)", { head, walk: node => map.get(node) });
  globalThis.fixture = null;
}

// Values whose keys died must be collected, also when the collector resolves the map through
// its key-to-values table. The live chain makes it build that table. The dead chain is in
// the same map, so its entries are in the table too.
const deadCount = 200;
let collected = 0;
const registry = new FinalizationRegistry(() => {
  collected++;
});

function addDeadChain(map) {
  let tail = { id: 0 };
  for (let id = 1; id <= deadCount; id++) {
    const next = { id };
    registry.register(next);
    map.set(tail, next);
    tail = next;
  }
}
noInline(addDeadChain);

function addLiveChain(map) {
  const head = { id: 0 };
  let tail = head;
  for (let id = 1; id <= count; id++) {
    const next = { id };
    map.set(tail, next);
    tail = next;
  }
  return head;
}
noInline(addLiveChain);

const mixedMap = new WeakMap();
addDeadChain(mixedMap);
const liveHead = addLiveChain(mixedMap);
globalThis.fixture = { map: mixedMap, head: liveHead };
// The registry runs its callbacks in a later task. Collect and wait until they all ran.
(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let attempt = 0; attempt < 50 && collected < deadCount; attempt++) {
    fullGC();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  shouldBe(collected, deadCount, "values of dead keys are collected");
  let visited = 0;
  for (let node = liveHead; node; node = mixedMap.get(node)) visited++;
  shouldBe(visited, count + 1, "live chain stays reachable");
  globalThis.fixture = null;
})();

{
  // A debug build marks far slower, and a sanitizer build slower still. The rounds check
  // above is the one that holds there; this bound is for the release build.
  const isDebug = Bun.version.includes("debug");
  const isASAN = process.execPath.includes("bun-asan") || isDebug;
  const longCount = isASAN ? 5000 : 40000;
  const bound = isASAN ? 30000 : 5000;
  for (const [name, build] of Object.entries(ephemeronChainShapes(longCount))) {
    const fixture = build();
    globalThis.fixture = fixture;
    const start = Date.now();
    fullGC();
    fullGC();
    const elapsed = Date.now() - start;
    if (elapsed > bound) throw new Error(`${name}: two full collections of ${longCount} entries took ${elapsed} ms`);
    let visited = 0;
    for (let node = fixture.head; node; node = fixture.walk(node)) visited++;
    shouldBe(visited, longCount + 1, `${name}: nodes reachable after GC at ${longCount} entries`);
    globalThis.fixture = null;
  }
}
