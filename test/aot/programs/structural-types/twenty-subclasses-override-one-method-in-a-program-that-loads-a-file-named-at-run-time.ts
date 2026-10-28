abstract class Animal {
  weight = 1;
  abstract sound(): string;
  twice(): string {
    return this.sound() + this.sound();
  }
}

class Ant extends Animal {
  antField = 0;
  sound(): string {
    return "ant" + this.antField;
  }
}

class Bee extends Animal {
  beeField = 1;
  sound(): string {
    return "bee" + this.beeField;
  }
}

class Cow extends Animal {
  cowField = 2;
  sound(): string {
    return "cow" + this.cowField;
  }
}

class Doe extends Animal {
  doeField = 3;
  sound(): string {
    return "doe" + this.doeField;
  }
}

class Eel extends Animal {
  eelField = 4;
  sound(): string {
    return "eel" + this.eelField;
  }
}

class Fox extends Animal {
  foxField = 5;
  sound(): string {
    return "fox" + this.foxField;
  }
}

class Gnu extends Animal {
  gnuField = 6;
  sound(): string {
    return "gnu" + this.gnuField;
  }
}

class Hen extends Animal {
  henField = 7;
  sound(): string {
    return "hen" + this.henField;
  }
}

class Ibis extends Animal {
  ibisField = 8;
  sound(): string {
    return "ibis" + this.ibisField;
  }
}

class Jay extends Animal {
  jayField = 9;
  sound(): string {
    return "jay" + this.jayField;
  }
}

class Koi extends Animal {
  koiField = 10;
  sound(): string {
    return "koi" + this.koiField;
  }
}

class Lynx extends Animal {
  lynxField = 11;
  sound(): string {
    return "lynx" + this.lynxField;
  }
}

class Mole extends Animal {
  moleField = 12;
  sound(): string {
    return "mole" + this.moleField;
  }
}

class Newt extends Animal {
  newtField = 13;
  sound(): string {
    return "newt" + this.newtField;
  }
}

class Owl extends Animal {
  owlField = 14;
  sound(): string {
    return "owl" + this.owlField;
  }
}

class Pig extends Animal {
  pigField = 15;
  sound(): string {
    return "pig" + this.pigField;
  }
}

class Quail extends Animal {
  quailField = 16;
  sound(): string {
    return "quail" + this.quailField;
  }
}

class Ram extends Animal {
  ramField = 17;
  sound(): string {
    return "ram" + this.ramField;
  }
}

class Seal extends Animal {
  sealField = 18;
  sound(): string {
    return "seal" + this.sealField;
  }
}

class Toad extends Animal {
  toadField = 19;
  sound(): string {
    return "toad" + this.toadField;
  }
}

function soundOf(a: Animal): string {
  return a.sound();
}

function chorus(list: Animal[]): string {
  let text = "";
  for (const a of list) text += a.sound() + " ";
  return text;
}

const zoo: Animal[] = [
  new Ant(),
  new Bee(),
  new Cow(),
  new Doe(),
  new Eel(),
  new Fox(),
  new Gnu(),
  new Hen(),
  new Ibis(),
  new Jay(),
  new Koi(),
  new Lynx(),
  new Mole(),
  new Newt(),
  new Owl(),
  new Pig(),
  new Quail(),
  new Ram(),
  new Seal(),
  new Toad(),
];

function round(label: string): void {
  console.log(
    label +
      ": " +
      chorus(zoo) +
      "| " +
      soundOf(zoo[7]) +
      " " +
      soundOf(zoo[19]) +
      " " +
      zoo[7].twice() +
      " " +
      new Hen().sound(),
  );
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += soundOf(zoo[i % 20]).length + zoo[i % 20].twice().length;
console.log("2000 honest: " + warm);
round("before");
round("again");
round("again");
round("again");
round("again");

try {
  require(process.argv[2]);
} catch (error) {
  console.log((error as Error).name);
}

export {};
