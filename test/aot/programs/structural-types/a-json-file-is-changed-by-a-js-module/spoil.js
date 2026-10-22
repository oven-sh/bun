import data from "./data.json";

export function spoil(step) {
  switch (step) {
    case 0:
      data.count = "three";
      break;
    case 1:
      data.origin.x = "one";
      break;
    case 2:
      data.origin = [7, 8];
      break;
    case 3:
      data.sizes.push("four");
      break;
    case 4:
      data.sizes = { length: 1, 0: "zero" };
      break;
    case 5:
      delete data.name;
      break;
    case 6:
      data.on = 0;
      break;
    case 7:
      data.extra = "extra";
      break;
  }
}
