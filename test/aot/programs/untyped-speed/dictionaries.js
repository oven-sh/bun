// Objects used as dictionaries: counts under computed keys, hasOwnProperty.call, `in`, `for in`, Object.keys, and `delete` inside a `for in` loop.
var hasOwn = Object.prototype.hasOwnProperty;

function countWords(words, rounds) {
  var counts = {};
  for (var r = 0; r < rounds; r++) {
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (hasOwn.call(counts, word)) counts[word]++;
      else counts[word] = 1;
    }
  }
  return counts;
}

function invert(table) {
  var out = {};
  for (var key in table) {
    if (!hasOwn.call(table, key)) continue;
    var bucket = "n" + (table[key] % 7);
    (out[bucket] || (out[bucket] = [])).push(key);
  }
  return out;
}

function sumValues(table) {
  var keys = Object.keys(table);
  var sum = 0;
  for (var i = 0; i < keys.length; i++) sum += table[keys[i]];
  return sum;
}

function prune(table, limit) {
  var removed = 0;
  for (var key in table) {
    if (table[key] < limit) {
      delete table[key];
      removed++;
    }
  }
  return removed;
}

function run() {
  var words = [];
  for (var i = 0; i < 400; i++) words.push("w" + ((i * 7) % 150));
  var total = 0;
  for (var round = 0; round < 60; round++) {
    var counts = countWords(words, 40);
    var groups = invert(counts);
    total += sumValues(counts) + Object.keys(groups).length;
    total += "w3" in counts ? 1 : 0;
    total += prune(counts, 90);
    for (var name in groups) total += groups[name].length;
  }
  return total;
}

console.log(run());
