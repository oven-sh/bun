// One barrel of a pure package re-exports by name, by star, a star of another barrel, a CommonJS file by name, a JSON file's default, and a name that both a clause and a star have. The program asks for one of each, and each kind has a neighbor nobody asks for.
import { byName, byStar, byInnerStar, fromCommonJS, data, inBoth } from "mixed-barrel";

console.log(byName(), byStar(), byInnerStar(), fromCommonJS(), data.kind, inBoth());
