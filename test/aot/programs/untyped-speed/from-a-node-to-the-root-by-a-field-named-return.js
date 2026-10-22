// From a node to the root of its tree by the field `return`, which generators have as a method, and a look at `flags` and `tag` on the way, which regular expressions
// and a dozen other kinds of objects have.
const word = process.argv[3] ?? "";
const open = new Function("value", "return value" + word.slice(word.length));

function TreeNode(tag) {
  this.tag = tag;
  this.flags = 0;
  this.return = null;
  this.state = null;
}

const others = [];
function makeOthers(k) {
  others.push({ tag: k, text: "t" }, { sides: k, tag: k }, { body: "b", sender: "s", tag: k }, { color: k, tag: k }, { tag: k, left: null, right: null });
}
for (let i = 0; i < 64; i++) makeOthers(i);

function rootOf(source) {
  for (var parent = source.return; null !== parent; ) (source = parent), (parent = source.return);
  return 3 === source.tag ? source.state : null;
}

function countMarked(node) {
  var marked = 0;
  for (var parent = node; null !== parent; ) {
    if (0 !== (parent.flags & 4)) marked++;
    else if (10 === parent.tag) break;
    parent = parent.return;
  }
  return marked;
}

function build(depth) {
  let parent = null;
  for (let i = 0; i < depth; i++) {
    const node = new TreeNode(i === 0 ? 3 : 5);
    node.return = parent;
    node.flags = i & 7;
    if (i === 0) node.state = { name: "root" };
    parent = node;
  }
  return parent;
}

const rounds = Number(process.argv[2] ?? 200000);
const leaf = open(build(12));
let found = 0, marked = 0;
for (let i = 0; i < rounds; i++) {
  if (rootOf(open(leaf)) !== null) found++;
  marked += countMarked(open(leaf));
}
console.log(found, marked, others.length);
