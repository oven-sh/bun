class Wide {
  n = 1;
  m1(): number {
    return this.n + 1;
  }
  m2(): number {
    return this.n + 2;
  }
  m3(): number {
    return this.n + 3;
  }
  m4(): number {
    return this.n + 4;
  }
  m5(): number {
    return this.n + 5;
  }
  m6(): number {
    return this.n + 6;
  }
  m7(): number {
    return this.n + 7;
  }
  m8(): number {
    return this.n + 8;
  }
  m9(): number {
    return this.n + 9;
  }
  m10(): number {
    return this.n + 10;
  }
  m11(): number {
    return this.n + 11;
  }
  m12(): number {
    return this.n + 12;
  }
  m13(): number {
    return this.n + 13;
  }
  m14(): number {
    return this.n + 14;
  }
  m15(): number {
    return this.n + 15;
  }
  m16(): number {
    return this.n + 16;
  }
  m17(): number {
    return this.n + 17;
  }
  m18(): number {
    return this.n + 18;
  }
  m19(): number {
    return this.n + 19;
  }
  m20(): number {
    return this.n + 20;
  }
  m21(): number {
    return this.n + 21;
  }
  m22(): number {
    return this.n + 22;
  }
  m23(): number {
    return this.n + 23;
  }
  m24(): number {
    return this.n + 24;
  }
  m25(): number {
    return this.n + 25;
  }
  m26(): number {
    return this.n + 26;
  }
  m27(): number {
    return this.n + 27;
  }
  m28(): number {
    return this.n + 28;
  }
  m29(): number {
    return this.n + 29;
  }
  m30(): number {
    return this.n + 30;
  }
  m31(): number {
    return this.n + 31;
  }
  m32(): number {
    return this.n + 32;
  }
  m33(): number {
    return this.n + 33;
  }
  m34(): number {
    return this.n + 34;
  }
  m35(): number {
    return this.n + 35;
  }
  m36(): number {
    return this.n + 36;
  }
  m37(): number {
    return this.n + 37;
  }
  m38(): number {
    return this.n + 38;
  }
  m39(): number {
    return this.n + 39;
  }
  m40(): number {
    return this.n + 40;
  }
  m41(): number {
    return this.n + 41;
  }
  m42(): number {
    return this.n + 42;
  }
  m43(): number {
    return this.n + 43;
  }
  m44(): number {
    return this.n + 44;
  }
  m45(): number {
    return this.n + 45;
  }
  m46(): number {
    return this.n + 46;
  }
  m47(): number {
    return this.n + 47;
  }
  m48(): number {
    return this.n + 48;
  }
  m49(): number {
    return this.n + 49;
  }
  m50(): number {
    return this.n + 50;
  }
  m51(): number {
    return this.n + 51;
  }
  m52(): number {
    return this.n + 52;
  }
  m53(): number {
    return this.n + 53;
  }
  m54(): number {
    return this.n + 54;
  }
  m55(): number {
    return this.n + 55;
  }
  m56(): number {
    return this.n + 56;
  }
  m57(): number {
    return this.n + 57;
  }
  m58(): number {
    return this.n + 58;
  }
  m59(): number {
    return this.n + 59;
  }
  m60(): number {
    return this.n + 60;
  }
  m61(): number {
    return this.n + 61;
  }
  m62(): number {
    return this.n + 62;
  }
  m63(): number {
    return this.n + 63;
  }
  m64(): number {
    return this.n + 64;
  }
  m65(): number {
    return this.n + 65;
  }
  m66(): number {
    return this.n + 66;
  }
  m67(): number {
    return this.n + 67;
  }
  m68(): number {
    return this.n + 68;
  }
  m69(): number {
    return this.n + 69;
  }
  m70(): number {
    return this.n + 70;
  }
}

class Below extends Wide {
  m70(): number {
    return super.m70() + 1000;
  }
}

function some(w: Wide): string {
  return [w.m1(), w.m2(), w.m32(), w.m33(), w.m63(), w.m64(), w.m65(), w.m66(), w.m69(), w.m70()].join(" ");
}

function all(w: Wide): number {
  return w.m1() + w.m2() + w.m3() + w.m4() + w.m5() + w.m6() + w.m7() + w.m8() + w.m9() + w.m10() + w.m11() + w.m12() + w.m13() + w.m14() + w.m15() + w.m16() + w.m17() + w.m18() + w.m19() + w.m20() + w.m21() + w.m22() + w.m23() + w.m24() + w.m25() + w.m26() + w.m27() + w.m28() + w.m29() + w.m30() + w.m31() + w.m32() + w.m33() + w.m34() + w.m35() + w.m36() + w.m37() + w.m38() + w.m39() + w.m40() + w.m41() + w.m42() + w.m43() + w.m44() + w.m45() + w.m46() + w.m47() + w.m48() + w.m49() + w.m50() + w.m51() + w.m52() + w.m53() + w.m54() + w.m55() + w.m56() + w.m57() + w.m58() + w.m59() + w.m60() + w.m61() + w.m62() + w.m63() + w.m64() + w.m65() + w.m66() + w.m67() + w.m68() + w.m69() + w.m70();
}

const w = new Wide();
const b = new Below();

function round(label: string): void {
  console.log(label + ": " + some(w) + " | " + all(w) + " | " + some(b) + " | " + all(b));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += all(w) + all(b);
console.log("2000 honest: " + warm);
round("before");
Wide.prototype.m1 = () => -1;
round("the first replaced");
Wide.prototype.m64 = () => -64;
round("the 64th");
Wide.prototype.m65 = () => -65;
round("the 65th");
Wide.prototype.m70 = () => -70;
round("the 70th");
w.m33 = () => -33;
round("an instance covers the 33rd");
b.m66 = () => -66;
round("an instance of the subclass covers the 66th");
Below.prototype.m2 = () => -2;
round("the subclass gets a second of its own");

export {};
