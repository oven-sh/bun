// Array callbacks in ES5 style over a list of 3,000 objects: filter, map, reduce, some, every, forEach, sort and find, with closures that read a property under a computed name.
function makeOrders(count) {
  var orders = [];
  for (var i = 0; i < count; i++) {
    orders.push({ id: i, customer: "c" + (i % 23), amount: (i * 37) % 500, open: i % 3 !== 0 });
  }
  return orders;
}

function pluck(name) {
  return function (item) {
    return item[name];
  };
}

function add(a, b) {
  return a + b;
}

function groupBy(list, keyOf) {
  return list.reduce(function (groups, item) {
    var key = keyOf(item);
    (groups[key] = groups[key] || []).push(item);
    return groups;
  }, {});
}

function report(orders) {
  var open = orders.filter(function (order) {
    return order.open;
  });
  var total = open.map(pluck("amount")).reduce(add, 0);
  var large = open.some(function (order) {
    return order.amount > 495;
  });
  var valid = orders.every(function (order) {
    return order.amount >= 0;
  });
  var groups = groupBy(open, pluck("customer"));
  var best = 0;
  Object.keys(groups).forEach(function (customer) {
    var spent = groups[customer].map(pluck("amount")).reduce(add, 0);
    if (spent > best) best = spent;
  });
  var sorted = open.slice(0, 200).sort(function (a, b) {
    return b.amount - a.amount || a.id - b.id;
  });
  var found = orders.find(function (order) {
    return order.id === 777;
  });
  return total + best + sorted[0].id + (large ? 1 : 0) + (valid ? 2 : 0) + found.amount + orders.indexOf(found);
}

function run(rounds) {
  var orders = makeOrders(3000);
  var total = 0;
  for (var i = 0; i < rounds; i++) total += report(orders);
  return total;
}

console.log(run(250));
