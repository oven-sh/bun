// Objects with more names than a chain of shapes holds, read, stored and tested by computed keys while their properties are added, deleted and redefined.
function fill(count, step) {
  var table = {};
  for (var i = 0; i < count; i++) table["k" + ((i * step) % count)] = i;
  return table;
}

function sum(table, names) {
  var total = 0;
  for (var i = 0; i < names.length; i++) {
    var value = table[names[i]];
    total += value === undefined ? -1000 : value;
  }
  return total;
}

function bump(table, names, by) {
  for (var i = 0; i < names.length; i++) table[names[i]] = table[names[i]] + by;
}

function present(table, names) {
  var own = 0;
  var found = 0;
  for (var i = 0; i < names.length; i++) {
    if (Object.prototype.hasOwnProperty.call(table, names[i])) own++;
    if (names[i] in table) found++;
  }
  return own + ":" + found;
}

function strictStore(table, name, value) {
  try {
    table[name] = value;
    return "stored";
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "other";
  }
}

var names = [];
for (var n = 0; n < 120; n++) names.push("k" + n);

var first = fill(120, 1);
var second = fill(120, 7);
for (var round = 0; round < 3; round++) console.log(sum(first, names), sum(second, names), present(first, names));
bump(first, names, 2);
bump(second, names, 3);
console.log(sum(first, names), sum(second, names));

console.log(first["later"], "later" in first, present(first, ["later"]));
first["later"] = 5;
console.log(first["later"], "later" in first, present(first, ["later"]));

var parent = { inherited: 11 };
var child = Object.create(parent);
for (var c = 0; c < 100; c++) child["c" + c] = c;
var inheritedName = ["inherited"];
console.log(sum(child, inheritedName), present(child, inheritedName));
console.log(sum(child, inheritedName), present(child, inheritedName));
child["inherited"] = 12;
console.log(sum(child, inheritedName), present(child, inheritedName), parent.inherited);
parent.inherited = 13;
console.log(sum(child, inheritedName));

delete first["k10"];
console.log(sum(first, names), present(first, names), first["k10"], first["k11"], first["k119"]);
first["k10"] = 77;
console.log(sum(first, names), present(first, names), Object.keys(first).slice(-2).join());
bump(first, names, 1);
console.log(sum(first, names));

var reads = 0;
Object.defineProperty(second, "k20", {
  get: function () {
    reads++;
    return 1000;
  },
  set: function (value) {
    reads += value;
  },
  enumerable: true,
  configurable: true,
});
console.log(sum(second, names), reads);
bump(second, names, 1);
console.log(sum(second, names), reads);

Object.defineProperty(second, "k30", { value: 9, writable: false });
console.log(second["k30"], strictStore(second, "k30", 10), strictStore(second, "k30", 11), strictStore(second, "k31", 12), second["k31"]);

var third = fill(90, 1);
console.log(sum(third, names), third.k5, third.k89, third.missing);
console.log(sum(third, names), third.k5, third.k89, third.missing);
third["k95"] = 1;
console.log(sum(third, names), third.k95);
Object.freeze(third);
console.log(sum(third, names), strictStore(third, "k5", 1), strictStore(third, "k97", 1), present(third, names));

var total = 0;
for (var repeat = 0; repeat < 200; repeat++) {
  var scratch = fill(70 + (repeat % 5), 1);
  bump(scratch, names.slice(0, 70), repeat);
  if (repeat % 3 === 0) delete scratch["k" + (repeat % 70)];
  total += sum(scratch, names);
}
console.log(total);
