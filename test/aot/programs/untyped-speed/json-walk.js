// A document of 500 items is parsed with JSON.parse again and again, walked recursively by `typeof`, Array.isArray and `for in`, and then read by name.
function makeDocument(count) {
  var items = [];
  for (var i = 0; i < count; i++) {
    items.push({
      id: i,
      name: "item " + i,
      tags: ["a" + (i % 5), "b" + (i % 3)],
      price: i % 4 === 0 ? null : (i * 13) % 97,
      nested: { depth: i % 6, flags: { hot: i % 2 === 0, label: i % 7 === 0 ? "sale" : undefined } },
    });
  }
  return JSON.stringify({ version: 3, items: items, meta: { count: count, source: "generated" } });
}

function walk(value, depth) {
  if (value === null) return 1;
  switch (typeof value) {
    case "number":
      return value & 255;
    case "string":
      return value.length;
    case "boolean":
      return value ? 2 : 3;
  }
  var total = depth;
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) total += walk(value[i], depth + 1);
    return total;
  }
  for (var key in value) total += key.length + walk(value[key], depth + 1);
  return total;
}

function summarize(document) {
  var total = 0;
  var items = document.items;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    total += item.price || 0;
    if (item.nested && item.nested.flags && item.nested.flags.label) total += item.nested.flags.label.length;
    total += item.tags.indexOf("a2") + item.nested.depth;
  }
  return total + document.meta.count;
}

function run(rounds) {
  var text = makeDocument(500);
  var total = 0;
  for (var i = 0; i < rounds; i++) {
    var document = JSON.parse(text);
    total += walk(document, 0) + summarize(document);
    if (i % 10 === 0) total += JSON.stringify(document.items[i % 500]).length;
  }
  return total;
}

console.log(run(250));
