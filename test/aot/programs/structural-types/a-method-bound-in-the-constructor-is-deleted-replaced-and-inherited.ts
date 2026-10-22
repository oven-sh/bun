class Button {
  label: string;
  clicks = 0;
  constructor(label: string) {
    this.label = label;
    this.click = this.click.bind(this);
  }
  click(): string {
    this.clicks++;
    return this.label + " clicked " + this.clicks;
  }
}

class Toggle extends Button {
  on = false;
  click(): string {
    this.on = !this.on;
    return super.click() + " " + this.on;
  }
}

class Silent extends Button {
  constructor(label: string) {
    super(label);
    this.click = () => "silent " + this.label;
  }
}

function clickOf(b: Button): string {
  return b.click();
}

function facts(b: Button): string {
  return b.click() + " | " + clickOf(b) + " | own " + Object.hasOwn(b, "click") + " | " + JSON.stringify(b.click.name) + " | keys " + Object.keys(b).join();
}

let warm = 0;
const steady = new Button("steady");
for (let i = 0; i < 2000; i++) warm += clickOf(steady).length;
console.log("2000 honest: " + warm);

const b = new Button("b");
console.log("bound: " + facts(b));
const taken = b.click;
console.log("taken off: " + taken() + " | " + taken.call(new Button("other")));

const view: { click?: () => string } = b;
delete view.click;
console.log("the own one deleted: " + facts(b));
const bare = b.click;
try {
  console.log("taken off now: " + bare());
} catch (error) {
  console.log("taken off now: threw " + (error instanceof Error ? error.constructor.name : typeof error));
}

b.click = () => "an arrow";
console.log("replaced: " + facts(b));
console.log("another button: " + facts(new Button("c")));

console.log("a subclass that overrides the method: " + facts(new Toggle("t")));
console.log("a subclass whose constructor covers it again: " + facts(new Silent("s")));

const original = Button.prototype.click;
Button.prototype.click = function () {
  return "patched " + this.label;
};
console.log("patched, an old button keeps what it bound: " + facts(steady).slice(0, 6) + " | a new one: " + facts(new Button("d")) + " | the one without its own: " + (delete view.click, facts(b)));
console.log("patched, the subclass through super: " + facts(new Toggle("u")));
Button.prototype.click = original;
console.log("restored: " + facts(new Button("e")));

const list: Button[] = [new Button("x"), new Toggle("y"), new Silent("z"), b];
console.log("elements: " + list.map(clickOf).join(" | "));

export {};
