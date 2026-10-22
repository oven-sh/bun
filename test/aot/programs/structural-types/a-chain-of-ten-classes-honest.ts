class Level0 {
  n = 0;
  who(): string {
    return "level 0";
  }
  up(): string {
    return "top";
  }
}

class Level1 extends Level0 {
  field1 = 1;
  up(): string {
    return "1 " + super.up();
  }
}

class Level2 extends Level1 {
  field2 = 2;
  up(): string {
    return "2 " + super.up();
  }
}

class Level3 extends Level2 {
  field3 = 3;
  who(): string {
    return "level 3";
  }
  up(): string {
    return "3 " + super.up();
  }
}

class Level4 extends Level3 {
  field4 = 4;
  up(): string {
    return "4 " + super.up();
  }
}

class Level5 extends Level4 {
  field5 = 5;
  up(): string {
    return "5 " + super.up();
  }
}

class Level6 extends Level5 {
  field6 = 6;
  who(): string {
    return "level 6";
  }
  up(): string {
    return "6 " + super.up();
  }
}

class Level7 extends Level6 {
  field7 = 7;
  up(): string {
    return "7 " + super.up();
  }
}

class Level8 extends Level7 {
  field8 = 8;
  up(): string {
    return "8 " + super.up();
  }
}

class Level9 extends Level8 {
  field9 = 9;
  who(): string {
    return "level 9";
  }
  up(): string {
    return "9 " + super.up();
  }
}

function whoOf(l: Level0): string {
  return l.who();
}

function bottomWho(l: Level9): string {
  return l.who() + " / " + l.up();
}

function fifthWho(l: Level5): string {
  return l.who() + " / " + l.up();
}

const all: Level0[] = [new Level0(), new Level1(), new Level2(), new Level3(), new Level4(), new Level5(), new Level6(), new Level7(), new Level8(), new Level9()];
const bottom = new Level9();
const fifth = new Level5();

function round(label: string): void {
  console.log(label + ": " + all.map(whoOf).join(", ") + " | " + bottomWho(bottom) + " | " + fifthWho(fifth) + " | " + fifthWho(bottom));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += whoOf(all[i % 10]).length + bottomWho(bottom).length + fifthWho(fifth).length;
console.log("2000 honest: " + warm);
round("before");
round("again");
round("again");
round("again");
round("again");
round("again");

export {};
