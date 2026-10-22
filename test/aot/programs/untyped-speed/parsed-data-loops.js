// Loops over what JSON.parse returned: a sum of numbers, the longest of some strings, and rows with nested objects and arrays of up to three tags.
var text = JSON.stringify({
  prices: Array.from({ length: 400 }, function (_, i) {
    return (i * 37) % 101;
  }),
  names: Array.from({ length: 100 }, function (_, i) {
    return "item" + (i % 17);
  }),
  rows: Array.from({ length: 60 }, function (_, i) {
    return { id: i, tags: ["a", "b", "c"].slice(0, i % 4), size: { w: i % 7, h: i % 5 } };
  }),
});

function sum(values) {
  var total = 0;
  for (var i = 0; i < values.length; i++) total += values[i];
  return total;
}

function longest(names) {
  var best = "";
  for (var i = 0; i < names.length; i++) {
    if (names[i].length > best.length) best = names[i];
  }
  return best;
}

function area(rows) {
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    total += row.size.w * row.size.h + row.tags.length;
    for (var j = 0; j < row.tags.length; j++) total += row.tags[j].charCodeAt(0) & 3;
  }
  return total;
}

function run(rounds) {
  var total = 0;
  var data = JSON.parse(text);
  for (var round = 0; round < rounds; round++) {
    if ((round & 255) === 0) data = JSON.parse(text);
    total += sum(data.prices) + longest(data.names).length + area(data.rows);
  }
  return total;
}

console.log(run(6000));
