// An object may or may not have a property of its own under a name that its prototypes have too: a default value, a method, a getter.
// Each read has to find the own property where there is one and what the prototypes have at that moment where there is none.
const lines = [];
function show(label, value) {
  lines.push(label + ": " + String(value));
}

function Widget(size) {
  this.size = size;
}
Widget.prototype.enabled = false;
Widget.prototype.weight = 2;
Widget.prototype.label = undefined;
Widget.prototype.render = function () {
  return "widget " + this.size;
};
Object.defineProperty(Widget.prototype, "area", {
  get: function () {
    return this.size * this.size;
  },
  configurable: true,
});
Object.defineProperty(Widget.prototype, "writeOnly", {
  set: function (value) {
    this.written = value;
  },
  configurable: true,
});

const widgets = [new Widget(1), new Widget(2), new Widget(3), new Widget(4)];
widgets[1].enabled = true;
widgets[2].weight = 5;
widgets[2].label = "third";
widgets[3].render = function () {
  return "custom " + this.size;
};
Object.defineProperty(widgets[3], "area", { value: -1, writable: true, enumerable: true, configurable: true });
Object.defineProperty(widgets[0], "writeOnly", { value: "own", writable: true, enumerable: true, configurable: true });

function describe(widget) {
  return [widget.enabled, widget.weight, widget.label, widget.render(), widget.area, widget.writeOnly, widget.written].join(" ");
}
function describeAll(when) {
  for (let i = 0; i < widgets.length; i++) show(when + " " + i, describe(widgets[i]));
}

describeAll("at first");

Widget.prototype.enabled = "by default";
Widget.prototype.weight = 7;
describeAll("other defaults");

delete widgets[1].enabled;
delete widgets[2].weight;
delete widgets[3].render;
delete widgets[3].area;
describeAll("own properties deleted");

widgets[1].enabled = 0;
try {
  widgets[3].area = 12;
} catch (error) {
  show("store that finds a getter alone", error instanceof TypeError);
}
widgets[2].writeOnly = "through the setter";
describeAll("stored again");

delete Widget.prototype.weight;
delete Widget.prototype.area;
describeAll("defaults deleted");

Object.setPrototypeOf(Widget.prototype, { weight: "one step further" });
describeAll("found one step further");
Object.setPrototypeOf(Widget.prototype, Object.prototype);
describeAll("and gone again");

function Gadget(size) {
  Widget.call(this, size);
}
Gadget.prototype = Object.create(Widget.prototype);
Gadget.prototype.constructor = Gadget;
Gadget.prototype.render = function () {
  return "gadget " + this.size + " (" + Widget.prototype.render.call(this) + ")";
};
const gadgets = [new Gadget(5), new Gadget(6)];
gadgets[1].enabled = "own";
gadgets[1].render = null;
for (const gadget of gadgets) show("gadget", [gadget.enabled, gadget.label, typeof gadget.render, gadget.render ? gadget.render() : "no method"].join(" "));

function Bare(value) {
  if (value !== undefined) this.value = value;
}
Bare.prototype = Object.create(null);
Bare.prototype.value = "inherited";
const bare = [new Bare(1), new Bare()];
show("prototype without a prototype", bare[0].value + " " + bare[1].value + " " + String(bare[1].missing));
delete Bare.prototype.value;
show("nothing left to find", bare[0].value + " " + String(bare[1].value));

function Loose(value) {
  if (value !== undefined) this.value = value;
}
Loose.prototype.value = "inherited";
const loose = [new Loose(1), new Loose()];
Object.setPrototypeOf(loose[1], null);
show("no prototype at all", loose[0].value + " " + String(loose[1].value));
Object.setPrototypeOf(loose[1], { value: "another prototype" });
show("another prototype", loose[0].value + " " + String(loose[1].value));

const seen = [];
function Watched(value) {
  if (value !== undefined) this.value = value;
}
Watched.prototype = new Proxy(
  { value: "behind the proxy" },
  {
    get(target, key, receiver) {
      seen.push(String(key) + (receiver instanceof Object ? " for an object" : ""));
      return Reflect.get(target, key, receiver);
    },
  },
);
const watched = [new Watched(1), new Watched()];
show("proxy as prototype", watched[0].value + " " + watched[1].value + " | " + seen.filter((entry) => entry.startsWith("value")).join(", "));

class Base {
  get kind() {
    return "base of " + this.name;
  }
  describe() {
    return "described " + this.name;
  }
}
class Derived extends Base {
  constructor(name, hides) {
    super();
    this.name = name;
    if (hides) {
      Object.defineProperty(this, "kind", { value: "own kind", configurable: true });
      this.describe = () => "own description of " + this.name;
    }
  }
}
for (const instance of [new Derived("a", false), new Derived("b", true)]) show("class", instance.kind + " | " + instance.describe());

function total(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const widget = widgets[i & 3];
    sum += (widget.enabled ? 1 : 0) + (widget.weight === undefined ? 3 : 1) + widget.render().length + (widget.area === undefined ? 1 : 2);
  }
  return sum;
}
show("in a loop", total(10000));

console.log(lines.join("\n"));
