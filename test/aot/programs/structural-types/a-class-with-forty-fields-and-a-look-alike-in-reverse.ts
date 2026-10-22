class Wide {
  f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; f6 = 6; f7 = 7;
  f8 = 8; f9 = 9; f10 = 10; f11 = 11; f12 = 12; f13 = 13; f14 = 14; f15 = 15;
  f16 = 16; f17 = 17; f18 = 18; f19 = 19; f20 = 20; f21 = 21; f22 = 22; f23 = 23;
  f24 = 24; f25 = 25; f26 = 26; f27 = 27; f28 = 28; f29 = 29; f30 = 30; f31 = 31;
  f32 = 32; f33 = 33; f34 = 34; f35 = 35; f36 = 36; f37 = 37; f38 = 38; f39 = 39;
  ends(): string {
    return this.f0 + ":" + this.f39;
  }
}

class Reverse {
  f39 = 1039; f38 = 1038; f37 = 1037; f36 = 1036; f35 = 1035; f34 = 1034; f33 = 1033; f32 = 1032;
  f31 = 1031; f30 = 1030; f29 = 1029; f28 = 1028; f27 = 1027; f26 = 1026; f25 = 1025; f24 = 1024;
  f23 = 1023; f22 = 1022; f21 = 1021; f20 = 1020; f19 = 1019; f18 = 1018; f17 = 1017; f16 = 1016;
  f15 = 1015; f14 = 1014; f13 = 1013; f12 = 1012; f11 = 1011; f10 = 1010; f9 = 1009; f8 = 1008;
  f7 = 1007; f6 = 1006; f5 = 1005; f4 = 1004; f3 = 1003; f2 = 1002; f1 = 1001; f0 = 1000;
  ends(): string {
    return "reverse " + this.f0 + ":" + this.f39;
  }
}

function sample(w: Wide): string {
  return [w.f0, w.f1, w.f5, w.f6, w.f7, w.f8, w.f15, w.f16, w.f20, w.f31, w.f32, w.f38, w.f39].join();
}

function total(w: Wide): number {
  let sum = 0;
  for (const value of Object.values(w)) sum += value;
  return sum;
}

function touch(w: Wide): void {
  w.f0 += 0.5;
  w.f7 = -7;
  w.f20 *= 2;
  w.f39++;
}

const wide = new Wide();
const reverse: Wide = new Reverse();

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sample(wide).length + wide.f39;
console.log("2000 honest: " + warm);

console.log("the class: " + sample(wide) + " " + wide.ends() + " " + total(wide));
console.log("the look-alike: " + sample(reverse) + " " + reverse.ends() + " " + total(reverse));
console.log("first keys: " + Object.keys(wide).slice(0, 3).join() + " against " + Object.keys(reverse).slice(0, 3).join());
console.log("instanceof: " + (wide instanceof Wide) + " " + (reverse instanceof Wide));

touch(wide);
touch(reverse);
console.log("stored, the class: " + sample(wide) + " " + total(wide));
console.log("stored, the look-alike: " + sample(reverse) + " " + total(reverse));

const copy: Omit<Wide, "ends"> = { ...reverse };
console.log("a copy keeps the look-alike's order: " + Object.keys(copy).slice(0, 2).join() + " " + Object.keys(copy).length);
console.log("json: " + JSON.stringify(reverse).slice(0, 40) + " " + JSON.stringify(wide).slice(0, 40));

const few: Pick<Wide, "f0" | "f39"> = reverse;
console.log("seen through two names: " + few.f0 + " " + few.f39 + " " + Object.keys(few).length);

const loose: Partial<Wide> = new Wide();
for (const key of ["f1", "f20", "f38"] satisfies (keyof Wide)[]) delete loose[key];
console.log("three fields deleted: " + Object.keys(loose).length + " " + loose.f0 + " " + loose.f1 + " " + loose.f20 + " " + loose.f21 + " " + loose.f38 + " " + loose.f39);
loose.f20 = 2000;
console.log("one stored again: " + Object.keys(loose).slice(-2).join() + " " + loose.f20);

const list: Wide[] = [new Wide(), new Reverse(), new Wide()];
console.log("elements: " + list.map(w => w.f39 - w.f0).join() + " " + list.map(w => w.ends()).join());

export {};
