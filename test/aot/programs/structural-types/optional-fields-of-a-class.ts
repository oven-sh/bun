class Profile {
  name = "profile";
  nickname?: string;
  age?: number = undefined;
  city?: string = "here";
}

class Ordered {
  b: number;
  a: number;
  c?: number;
  constructor(flip: boolean) {
    if (flip) {
      this.a = 1;
      this.b = 2;
    } else {
      this.b = 2;
      this.a = 1;
    }
  }
}

class WithParameter {
  constructor(
    public id: number,
    public alias?: string,
  ) {}
}

class Child extends Profile {
  nickname?: string = undefined;
  extra?: boolean;
}

function listing(o: object): string {
  return Object.keys(o).join() + " " + JSON.stringify(o) + " copy " + Object.keys({ ...o }).join();
}

function nickname(p: Profile): string {
  return p.nickname ?? "none";
}

function hasNickname(p: Profile): boolean {
  return "nickname" in p;
}

const p = new Profile();
console.log("a fresh profile: " + listing(p));
console.log("nickname: " + hasNickname(p) + " " + Object.hasOwn(p, "nickname") + " " + nickname(p));
console.log("age: " + ("age" in p) + " " + p.age + ", city: " + ("city" in p) + " " + p.city);

p.nickname = "nick";
console.log("stored: " + listing(p) + " " + nickname(p));
delete p.nickname;
console.log("deleted: " + listing(p) + " " + hasNickname(p) + " " + nickname(p));
p.nickname = "back";
console.log("stored again: " + listing(p));
delete p.city;
delete p.age;
console.log("two more deleted: " + listing(p));

console.log("assigned b then a: " + listing(new Ordered(false)));
console.log("assigned a then b: " + listing(new Ordered(true)));

console.log("parameter properties, one given: " + listing(new WithParameter(1)) + " " + ("alias" in new WithParameter(1)));
console.log("parameter properties, both given: " + listing(new WithParameter(1, "a")));
console.log("parameter properties, undefined given: " + listing(new WithParameter(1, undefined)));

const child = new Child();
console.log("a subclass that declares it again: " + listing(child));
child.nickname = "kid";
console.log("stored: " + listing(child) + " " + nickname(child));

const literal: Profile = { name: "literal" };
const full: Profile = { city: "there", age: 3, nickname: "full", name: "full" };
console.log("a literal without them: " + listing(literal) + " " + hasNickname(literal) + " " + nickname(literal));
console.log("a literal with all, backwards: " + listing(full) + " " + hasNickname(full) + " " + nickname(full));

let count = 0;
for (let i = 0; i < 2000; i++) if (hasNickname(new Profile())) count++;
console.log("2000 instances: " + count);
console.log("then the literals: " + hasNickname(literal) + " " + hasNickname(full) + ", one with it deleted: " + hasNickname(p));

const everyone: Profile[] = [new Profile(), literal, full, child, p];
console.log("nicknames: " + everyone.map(nickname).join());
console.log("have it: " + everyone.map(hasNickname).join());
console.log("json: " + JSON.stringify(everyone));

export {};
