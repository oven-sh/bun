// A function that stores to many fields which lie out of line takes their storage once. Nobody sees room that no field uses yet.
class Options {
  declare o0?: any; declare o1?: any; declare o2?: any; declare o3?: any; declare o4?: any; declare o5?: any; declare o6?: any; declare o7?: any; declare o8?: any; declare o9?: any; declare o10?: any; declare o11?: any; declare o12?: any; declare o13?: any; declare o14?: any; declare o15?: any; declare o16?: any; declare o17?: any; declare o18?: any; declare o19?: any; declare o20?: any; declare o21?: any; declare o22?: any; declare o23?: any;
  declare update: (given: any) => void;
  constructor(given: any) {
    this.update = (given: any) => {
      this.o0 = given.o0;
      this.o1 = given.o1;
      this.o2 = given.o2;
      this.o3 = given.o3;
      this.o4 = given.o4;
      this.o5 = given.o5;
      this.o6 = given.o6;
      this.o7 = given.o7;
      this.o8 = given.o8;
      this.o9 = given.o9;
      this.o10 = given.o10;
      this.o11 = given.o11;
      this.o12 = given.o12;
      this.o13 = given.o13;
      this.o14 = given.o14;
      this.o15 = given.o15;
      this.o16 = given.o16;
      this.o17 = given.o17;
      this.o18 = given.o18;
      this.o19 = given.o19;
      this.o20 = given.o20;
      this.o21 = given.o21;
      this.o22 = given.o22;
      this.o23 = given.o23;
    };
    this.update(given);
  }
}
function look(options: Options): string { return Object.keys(options).filter(key => key !== "update").join("") + ":" + Object.values(options).filter(value => typeof value !== "function").join(""); }
const full: Record<string, number> = {};
for (let i = 0; i < 24; i++) full["o" + i] = i % 10;
const kept: Options[] = [];
for (let i = 0; i < 20; i++) kept.push(new Options(full));
console.log(look(kept[0]));
const failing: Record<string, unknown> = { ...full };
Object.defineProperty(failing, "o9", { get() { throw new RangeError("nine"); }, enumerable: true });
let half: Options | undefined;
class Watched extends Options { constructor(given: any) { try { super(given); } catch (error) { console.log((error as Error).message); throw error; } } }
try { new Watched(failing); } catch (error) { console.log(error instanceof RangeError); }
const later = new Options({});
console.log(look(later), "o3" in later, later.o3, Object.keys(later).length);
try { later.update(failing); } catch (error) { console.log((error as Error).message, look(later), "o9" in later, "o23" in later, later.o23); }
later.update({ o20: 5 });
console.log(look(later), later.o20, later.o9, Object.keys(later).length);
delete (later as any).o4; later.update(full);
console.log(look(later));
let garbage: Options[] = [];
for (let round = 0; round < 60; round++) { garbage = []; for (let i = 0; i < 300; i++) garbage.push(new Options(full)); }
console.log(look(garbage[299]) === look(kept[0]), look(kept[19]) === look(kept[0]), JSON.stringify(later).length, half);
class Bare {
  declare o0?: any; declare o1?: any; declare o2?: any; declare o3?: any; declare o4?: any; declare o5?: any; declare o6?: any; declare o7?: any; declare o8?: any; declare o9?: any; declare o10?: any; declare o11?: any; declare o12?: any; declare o13?: any; declare o14?: any; declare o15?: any; declare o16?: any; declare o17?: any; declare o18?: any; declare o19?: any; declare o20?: any; declare o21?: any; declare o22?: any; declare o23?: any;
  fill(given: any): void {
    this.o0 = given.o0;
    this.o1 = given.o1;
    this.o2 = given.o2;
    this.o3 = given.o3;
    this.o4 = given.o4;
    this.o5 = given.o5;
    this.o6 = given.o6;
    this.o7 = given.o7;
    this.o8 = given.o8;
    this.o9 = given.o9;
    this.o10 = given.o10;
    this.o11 = given.o11;
    this.o12 = given.o12;
    this.o13 = given.o13;
    this.o14 = given.o14;
    this.o15 = given.o15;
    this.o16 = given.o16;
    this.o17 = given.o17;
    this.o18 = given.o18;
    this.o19 = given.o19;
    this.o20 = given.o20;
    this.o21 = given.o21;
    this.o22 = given.o22;
    this.o23 = given.o23;
  }
}
const bare = new Bare();
console.log(Object.keys(bare).length, "o0" in bare);
try { bare.fill(failing); } catch (error) { console.log((error as Error).message, Object.keys(bare).join(""), Object.values(bare).join(""), "o9" in bare, "o23" in bare, bare.o9, bare.o23, JSON.stringify(bare)); }
const copy = { ...bare };
console.log(Object.keys(copy).join(""), Object.getOwnPropertyNames(bare).length);
bare.o23 = "last"; bare.o12 = "middle";
console.log(Object.keys(bare).join(""), bare.o23, bare.o12, bare.o13, "o13" in bare);
bare.fill(full);
console.log(Object.keys(bare).join(""), Object.values(bare).join(""));
