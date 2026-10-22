function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Builder {
  parts: string[] = [];
  size: number = 0;
  add(part: string): this {
    this.parts.push(part);
    this.size++;
    return this;
  }
  self(): this {
    return this;
  }
  build(): string {
    return this.parts.join("+") + " (" + this.size + ")";
  }
}
class Loud extends Builder {
  volume: number = 11;
  shout(): this {
    this.parts.push("!");
    return this;
  }
}

const builder = new Builder();
show("honest chain", () => builder.add("a").add("b").build());
const { add, self: same, build } = builder;
show("bare add", () => add("c"));
show("bare self", () => same());
show("bare self, then a member", () => same().size);
show("bare self, then a chain", () => same().add("d").build());
show("bare build", () => build());

const like = { parts: ["x"], size: 1 };
show("self on a look-alike is the look-alike", () => builder.self.call(like) === like);
show("add on a look-alike", () => builder.add.call(like, "y") === like);
show("the look-alike afterwards", () => JSON.stringify(like));
show("build on a look-alike", () => builder.build.call(like));
show("add on a look-alike with a string for parts", () => builder.add.call({ parts: "text", size: 0 }, "y"));
show("add on a set for parts", () => JSON.stringify(builder.add.call({ parts: new Set<string>(), size: 0 }, "y")));
show("self on a number", () => typeof builder.self.call(5));
show("self on a string", () => typeof builder.self.call("four"));

const loud = new Loud();
show("a subclass chain", () => loud.add("a").shout().add("b").build());
show("the base method on the subclass returns the subclass", () => loud.self().volume);
show("the subclass's method on a base instance", () => loud.shout.call(new Builder()).build());
show("and then a member the base lacks", () => loud.self.call(new Builder()).size);
show("map add", () => ["p", "q"].map(builder.add));
show("map add with the builder", () => ["p", "q"].map(builder.add, builder).length);
show("the builder afterwards", () => builder.build());
