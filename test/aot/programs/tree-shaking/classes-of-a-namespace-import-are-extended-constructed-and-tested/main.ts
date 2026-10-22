// Classes that are reached only as members of a namespace import: after extends, after new, on the right of instanceof, and in a static call.
import * as shapes from "./shapes";

class Square extends shapes.Shape {
  sides() { return 4; }
}

console.log(new Square().describe());
console.log(new shapes.Circle().describe());
console.log(new Square() instanceof shapes.Shape, new Square() instanceof shapes.Marker);
console.log(shapes.Factory.make().describe());
