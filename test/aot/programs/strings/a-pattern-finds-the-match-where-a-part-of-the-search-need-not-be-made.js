// Plain Bun gives a match up at the hundred millionth turn that the groups of a pattern begin, and then answers that there is none. An executable does not begin the turns of which it can tell
// beforehand that they fail, so it finds some of those matches. The language knows no limit: what it finds is the match.
const nothing = String(Date.now()).slice(99);
const show = (what, match) => console.log(what, match ? match.index + " " + match[0].length : "none");
// Alternatives that are single characters are one class.
show("one class", /(?:x|x)*y|$/.exec("x".repeat(40) + "c"));
show("one class", /(?:^(?:x|[xw])*y)|c/.exec("x".repeat(40) + "c"));
// A run in front of a group, none of whose characters the group can begin with, gives none of them back.
show("a run in front of a group", /q\/[^\/]*x[^\/]*(?:\/[^\/]+)*\/y|$/.exec("q/" + "x".repeat(15000) + "/c"));
show(
  "a run in front of a group",
  new RegExp("q/[^/]*x[^/]*(?:/[^/]+)*/y|$" + nothing).exec("q/" + "x".repeat(15000) + "/c"),
);
// No attempt is made in front of the last character that no match can hold.
show("a text that every match holds", new RegExp("(a+)+b" + nothing).exec("a".repeat(30) + "cab"));
show("a text that every match holds", /(a+)+b/.exec("a".repeat(30) + "cab"));
// A turn that takes nothing.
show("a turn that takes nothing", new RegExp("([^0]*)+1|$" + nothing).exec("2".repeat(23) + "0"));
show("a turn that takes nothing", /([^0]*)+1|$/.exec("2".repeat(23) + "0"));
