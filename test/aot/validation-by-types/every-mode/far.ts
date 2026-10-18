import type Root from "./far/leaf";
import type Trunk from "./far/trunk";
import type Everything from "./far/index";
import type { Branch, Foliage, TimeOfYear } from "./far/barrel";
import * as trees from "./far/leaf";
import { described } from "./far/made";
import { defaults, limits } from "./far/values";

function show(what: string, parse: () => unknown): void {
  try {
    console.log(what, "|", JSON.stringify(parse()));
  } catch (error: any) {
    console.log(what, "|", error.constructor.name, "|", error.message);
  }
}

show("through export *", () => JSON.parse<Branch>('{"leaves":[{"color":"green","veins":3}],"length":2}'));
show("through export *, a misfit two files away", () => JSON.parse<Branch>('{"leaves":[{"color":"blue","veins":3}],"length":2}'));
show("renamed by a re-export", () => JSON.parse<Foliage>('{"color":"red","veins":"3"}'));
show("an enum renamed by a re-export", () => JSON.parse<TimeOfYear>('"fall"'));
show("an enum renamed by a re-export, a misfit", () => JSON.parse<TimeOfYear>('"winter"'));
show("a default export", () => JSON.parse<Root>('{"depth":"1"}'));
show("a default export by name", () => JSON.parse<Trunk>('{"girth":"1"}'));
show("a member of a default export that is the module itself", () => JSON.parse<Everything.Branch>('{"leaves":[],"length":"2"}'));
show("through a namespace", () => JSON.parse<trees.Leaf>('{"color":"red"}'));
show("import type in place", () => JSON.parse<import("./far/leaf").Leaf>('{"color":"red","veins":null}'));
show("typeof a value whose type is inferred two files away", () => JSON.parse<typeof defaults>('{"name":"elm","height":2,"season":"spring","rings":[]}'));
show("typeof such a value, a misfit", () => JSON.parse<typeof defaults>('{"name":"elm","height":2,"season":"summer","rings":[]}'));
show("typeof a value with a written type", () => JSON.parse<typeof limits>('{"low":0}'));
show("the return type of an imported function", () => JSON.parse<ReturnType<typeof described>>('{"kind":1}'));
show("a global of a declaration file of the project", () => JSON.parse<Acorn>('{"weight":"1"}'));
show("a global that a module nobody imports declares", () => JSON.parse<Sapling>('{"age":"1"}'));
show("Bun.validate through export *", () => Bun.validate<Branch>({ leaves: [{ color: "green", veins: "3" }], length: 2 }));
