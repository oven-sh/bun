// An unused declaration reads a global that does not exist. A bare read throws, and so does a member of it; behind a typeof test it is not read at all. Each case is a file of its own, loaded here, and says whether it threw.
const loads = {
  "a bare name": () => import("./missing/bare.js"),
  "a member": () => import("./missing/member.js"),
  "in an object": () => import("./missing/in-object.js"),
  "after extends": () => import("./missing/extends.js"),
  "a statement": () => import("./missing/statement.js"),
  "typeof": () => import("./missing/typeof.js"),
  "guarded by &&": () => import("./missing/guarded-and.js"),
  "guarded by ?:": () => import("./missing/guarded-conditional.js"),
  "guarded the wrong way": () => import("./missing/guarded-wrong.js"),
  "guarded by another name": () => import("./missing/guarded-other.js"),
  "a member behind a guard": () => import("./missing/guarded-member.js"),
  "an optional chain": () => import("./missing/optional.js"),
  "globalThis.name": () => import("./missing/global-this.js"),
};
for (const name in loads) {
  try {
    await loads[name]();
    console.log(name + ": loaded");
  } catch (error) {
    console.log(name + ": " + error.name);
  }
}
