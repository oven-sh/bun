// @bun
// From JSTests/stress/weakmap-ephemeron-chain.js and resources/weakmap-ephemeron-chains.js in
// oven-sh/WebKit, with the shapes inlined.
// The collector resolves a chain of WeakMap entries through a key-to-values table once the
// chain has cost it Options::ephemeronFixpointIterations() marking rounds. Every shape must
// keep all of its values alive, and the table must not keep the values of dead keys alive.
// The last block checks the time it takes: two full collections of a 40,000 entry chain took
// about 18 seconds before the table, and take tens of milliseconds with it.

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

function checkReachable(name, fixture) {
  let visited = 0;
  for (let node = fixture.head; node; node = fixture.walk(node)) visited++;
  shouldBe(visited, count + 1, `${name}: nodes reachable after GC`);
}

for (const [name, build] of Object.entries(ephemeronChainShapes(count))) {
  // A chain that has never been through a full collection: every key is new.
  let fixture = build();
  globalThis.fixture = fixture;
  edenGC();
  edenGC();
  checkReachable(`${name} (eden)`, fixture);
  fullGC();
  fullGC();
  edenGC();
  checkReachable(`${name} (full)`, fixture);
  fixture = null;
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
setTimeout(() => {
  fullGC();
  fullGC();
  setTimeout(() => {
    shouldBe(collected, deadCount, "values of dead keys are collected");
    let visited = 0;
    for (let node = liveHead; node; node = mixedMap.get(node)) visited++;
    shouldBe(visited, count + 1, "live chain stays reachable");
    globalThis.fixture = null;
  }, 0);
}, 0);

{
  // A debug build marks far slower, and under a sanitizer slower still.
  const isDebug = Bun.version.includes("debug");
  const longCount = isDebug ? 20000 : 40000;
  const bound = isDebug ? 30000 : 5000;
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
