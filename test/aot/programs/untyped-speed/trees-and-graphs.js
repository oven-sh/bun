// A binary search tree of ES5 nodes, filled recursively, searched in a loop and walked with a callback, and a breadth-first search over a graph kept in dictionaries.
function TreeNode(key, value) {
  this.key = key;
  this.value = value;
  this.left = null;
  this.right = null;
}

function insert(node, key, value) {
  if (node === null) return new TreeNode(key, value);
  if (key < node.key) node.left = insert(node.left, key, value);
  else if (key > node.key) node.right = insert(node.right, key, value);
  else node.value = value;
  return node;
}

function find(node, key) {
  while (node !== null) {
    if (key === node.key) return node.value;
    node = key < node.key ? node.left : node.right;
  }
  return -1;
}

function height(node) {
  return node === null ? 0 : 1 + Math.max(height(node.left), height(node.right));
}

function inOrder(node, visit) {
  if (node === null) return;
  inOrder(node.left, visit);
  visit(node);
  inOrder(node.right, visit);
}

function Graph() {
  this.edges = {};
}
Graph.prototype.connect = function (from, to) {
  (this.edges[from] || (this.edges[from] = [])).push(to);
  (this.edges[to] || (this.edges[to] = [])).push(from);
};
Graph.prototype.distances = function (start) {
  var distance = {};
  distance[start] = 0;
  var queue = [start];
  for (var head = 0; head < queue.length; head++) {
    var node = queue[head];
    var neighbors = this.edges[node] || [];
    for (var i = 0; i < neighbors.length; i++) {
      var next = neighbors[i];
      if (distance[next] === undefined) {
        distance[next] = distance[node] + 1;
        queue.push(next);
      }
    }
  }
  return distance;
}

function run(rounds) {
  var total = 0;
  var graph = new Graph();
  for (var n = 0; n < 60; n++) {
    graph.connect("n" + n, "n" + ((n * 7 + 3) % 60));
    graph.connect("n" + n, "n" + ((n + 1) % 60));
  }
  for (var round = 0; round < rounds; round++) {
    var root = null;
    var seed = round + 1;
    for (var i = 0; i < 300; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      root = insert(root, seed % 1000, i);
    }
    for (var key = 0; key < 1000; key += 3) total += find(root, key) & 7;
    var sum = 0;
    inOrder(root, function (node) {
      sum = (sum * 31 + node.key) % 65521;
    });
    total += sum + height(root);
    var distance = graph.distances("n" + (round % 60));
    total += distance["n" + ((round * 13) % 60)];
  }
  return total;
}

console.log(run(2500));
