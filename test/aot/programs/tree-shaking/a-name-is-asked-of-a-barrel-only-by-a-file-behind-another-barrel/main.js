// Two pure packages, each with a barrel. The program asks the first barrel for one name. The file behind it asks the second barrel for a name, the file behind that asks the first barrel for another, and that one asks its own barrel for a third. Every file prints when it is evaluated.
import { start } from "first-barrel";

console.log(start());
