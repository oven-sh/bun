// Sorting with comparators put together from closures that read a property under a computed name, grouping into a dictionary, unique values through a Set, and a binary search.
function byKey(key, direction) {
  return function (a, b) {
    var x = a[key];
    var y = b[key];
    return (x < y ? -1 : x > y ? 1 : 0) * direction;
  };
}

function chain() {
  var comparators = Array.prototype.slice.call(arguments);
  return function (a, b) {
    for (var i = 0; i < comparators.length; i++) {
      var order = comparators[i](a, b);
      if (order) return order;
    }
    return 0;
  };
}

function groupBy(items, key) {
  var groups = {};
  items.forEach(function (item) {
    var name = item[key];
    (groups[name] || (groups[name] = [])).push(item);
  });
  return groups;
}

function unique(values) {
  return Array.from(new Set(values));
}

function lowerBound(sorted, value) {
  var low = 0;
  var high = sorted.length;
  while (low < high) {
    var middle = (low + high) >>> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function makeItems(count, seed) {
  var teams = ["red", "green", "blue", "gold"];
  var items = [];
  for (var i = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    items.push({ id: i, team: teams[seed & 3], score: (seed >>> 8) % 50, name: "p" + ((seed >>> 16) % 30) });
  }
  return items;
}

function run(rounds) {
  var total = 0;
  for (var round = 0; round < rounds; round++) {
    var items = makeItems(120, round + 1);
    items.sort(chain(byKey("team", 1), byKey("score", -1), byKey("name", 1)));
    total += items[0].id + items[60].id + items[119].id;
    var groups = groupBy(items, "team");
    for (var team in groups) total += groups[team].length * team.length;
    var scores = unique(
      items.map(function (item) {
        return item.score;
      }),
    ).sort(function (a, b) {
      return a - b;
    });
    total += scores.length + lowerBound(scores, 25) + lowerBound(scores, round % 50);
  }
  return total;
}

console.log(run(2500));
