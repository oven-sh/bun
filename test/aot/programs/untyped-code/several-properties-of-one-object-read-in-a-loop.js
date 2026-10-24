// A loop that reads or writes several properties of the object it walks over, in a function that is called once: the objects have the one shape the names suggest, then another shape with the same names, accessors, a prototype that holds a name, a proxy, a primitive; and the shape changes between two reads of one turn.
const print = (s) => console.log(s);
function add(parent, key, value) {
  return { key, value, parent };
}
function find(list, key) {
  for (let entry = list; entry; entry = entry.parent) {
    if (entry.key === key)
      return entry.value;
  }
  return "absent";
}
function sum(list) {
  let total = 0;
  for (let entry = list; entry; entry = entry.parent) {
    total += entry.value;
    entry.value = total;
    total += entry.key.length;
  }
  return total;
}
let list;
for (let i = 0; i < 6; i++)
  list = add(list, "k" + i, i);
print(find(list, "k0") + " " + find(list, "k5") + " " + find(list, "k9"));
print(sum(list) + " " + sum(list) + " " + find(list, "k2"));

const reordered = { parent: list, value: 100, key: "reordered" };
const wider = { key: "wider", value: 200, parent: reordered, more: 1 };
const inherited = Object.create({ key: "inherited", value: 300 });
inherited.parent = wider;
let reads = 0;
const computed = {
  get key() {
    reads++;
    return "computed";
  },
  get value() {
    reads++;
    return 400;
  },
  set value(v) {
    reads += 10;
  },
  get parent() {
    reads++;
    return inherited;
  },
};
const trapped = new Proxy({ key: "trapped", value: 500, parent: computed }, {
  get(target, name) {
    reads += 100;
    return target[name];
  },
});
const head = add(trapped, "head", 600);
for (const key of ["head", "trapped", "computed", "inherited", "wider", "reordered", "k3", "none"])
  print(key + ": " + find(head, key) + " after " + reads);
print(sum(head) + " after " + reads);

function findAndChange(list, key) {
  let seen = "";
  for (let entry = list; entry; entry = entry.parent) {
    const k = entry.key;
    if (k === key) {
      delete entry.key;
      entry.extra = k;
      entry.key = k + "!";
    }
    seen += entry.key + "=" + entry.value + " ";
  }
  return seen;
}
let changing;
for (let i = 0; i < 4; i++)
  changing = add(changing, "c" + i, i);
print(findAndChange(changing, "c2"));
print(findAndChange(changing, "c2!"));
print(findAndChange(changing, "c0"));
print(Object.keys(changing.parent).join());

function lengths(items) {
  let text = "";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      text += item.key + "/" + item.value + "/" + item.parent + " ";
    } catch (e) {
      text += e.name + " ";
    }
  }
  return text;
}
print(lengths([add(undefined, "a", 1), "text", 5, null, add(null, "b", 2), undefined, true, [], add(0, "c", 3), Symbol.iterator, 10n]));
