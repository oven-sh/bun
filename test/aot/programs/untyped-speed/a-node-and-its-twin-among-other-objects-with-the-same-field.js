// A tree of nodes made by a constructor function, each with a twin, walked from a leaf to the root as a UI library marks an update.
// Four other kinds of objects have a field of the same name as the one the walk asks the twin for, and they are made more often.
const word = process.argv[3] ?? "";
const open = new Function("value", "return value" + word.slice(word.length));

function TreeNode(tag) {
  this.tag = tag;
  this.lanes = 0;
  this.childLanes = 0;
  this.twin = null;
  this.parent = null;
  this.state = null;
}

function makeQueue() { return { pending: null, lanes: 0, dispatch: null }; }
function makeDependencies() { return { lanes: 0, first: null }; }
function makeShared() { return { interleaved: null, lanes: 0, callbacks: null, hidden: null }; }
function makeRoad() { return { name: "road", width: 3, length: 12, lanes: 2 }; }

function markFromLeaf(source, lane) {
  source.lanes |= lane;
  var twin = source.twin;
  null !== twin && (twin.lanes |= lane);
  for (var parent = source.parent; null !== parent; )
    (parent.childLanes |= lane),
      (twin = parent.twin),
      null !== twin && (twin.childLanes |= lane),
      (source = parent),
      (parent = parent.parent);
  return 3 === source.tag ? source.state : null;
}

function build(depth) {
  let parent = null, parentTwin = null, leaf = null;
  for (let i = 0; i < depth; i++) {
    const node = new TreeNode(i === 0 ? 3 : 5), twin = new TreeNode(i === 0 ? 3 : 5);
    node.twin = twin; twin.twin = node;
    node.parent = parent; twin.parent = parentTwin;
    if (i === 0) node.state = twin.state = { name: "root" };
    parent = node; parentTwin = twin; leaf = node;
  }
  return leaf;
}

let others = 0;
for (let i = 0; i < 4000; i++) others += makeQueue().lanes + makeDependencies().lanes + makeShared().lanes + makeRoad().lanes;

const rounds = Number(process.argv[2] ?? 200000);
const leaf = open(build(12));
let found = 0;
for (let i = 0; i < rounds; i++) if (markFromLeaf(open(leaf), 1 << (i & 15)) !== null) found++;
console.log(found, others, leaf.lanes, leaf.twin.lanes, leaf.parent.childLanes);
