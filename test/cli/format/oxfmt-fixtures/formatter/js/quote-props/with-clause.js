// Import with attributes - consistent should quote all when one requires quotes
import A from "test" with {
  "tess-sdt": "a",
  sd: "b"
};

// Import with no quotes needed
import B from "test2" with {
  type: "json",
  encoding: "utf8"
};

// Export with attributes
export { foo } from "bar" with {
  "x-y": "value",
  normal: "other"
};
