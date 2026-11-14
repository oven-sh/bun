// Three component files in a build whose plugin answers late: one that is parsed long before the plugin answers, one that only a file from the plugin imports, and one whose text the plugin provides.
import { Early } from "./Early";
import { Late } from "./gate";
import note from "./note.txt";
import { Provided } from "./Provided";

console.log(Early({ title: "early" }));
console.log(Late({ title: "late" }));
console.log(Provided({ title: "provided" }));
console.log(note.trim());
