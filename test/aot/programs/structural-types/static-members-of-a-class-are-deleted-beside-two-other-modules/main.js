const programs = {
  0: () => import("./p0.js"),
  1: () => import("./p1.js"),
  2: () => import("./p2.js"),
};
await programs[0]();
