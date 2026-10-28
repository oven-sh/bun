// The elements come out of JSON.parse, so that nothing about them is known before the program runs. The list itself is an array of the program.
function make(kind, length) {
  var items = [];
  for (var i = 0; i < length; i++) {
    var n = (i * 7919 + 13) % 1000;
    if (kind === "integers") items.push(n);
    else if (kind === "fractions") items.push(n + 0.25);
    else if (kind === "words") items.push("w" + (n % 10));
    else if (kind === "mixed") items.push(i === length >> 1 ? "x" : n);
    else if (kind === "rarelyText") items.push(i % 1000 === 999 ? String(n) : n);
    else if (kind === "permutation") items.push((i * 7 + 3) % length);
  }
  var parsed = JSON.parse(JSON.stringify({ items: items }));
  var copy = [];
  for (var j = 0; j < length; j++) copy.push(parsed.items[j]);
  return copy;
}

function kernel(values) {
  var total = 0;
  for (var i = 0; i < values.length; i += 50) {
    var row = 0;
    for (var j = i; j < i + 50 && j < values.length; j++) row += values[j];
    total += row % 97;
  }
  return total;
}

var input = make("integers", 1000);
var checksum = 0;
for (var round = 0; round < 30000; round++) checksum = (checksum + kernel(input)) % 1000000007;
console.log(checksum);
