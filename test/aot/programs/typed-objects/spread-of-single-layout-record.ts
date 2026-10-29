// Every object of the type is made by the literals below, so a spread of one copies it without asking what it is. What is no object, and an object with a property of its own beside its fields, still go the general way.
// CALLS+ copy CopyTypedObject32
// CALLS+ rename CopyTypedObject32
// SIZE< copy 100
// SIZE< rename 150
type Shape = { name: string; next: Shape | undefined; sides: number; label?: string };
function copy(shape: Shape): Shape { return { ...shape }; }
function rename(shape: Shape, name: string): Shape { return { ...shape, name }; }
const makers: ((shape: Shape, name: string) => Shape)[] = [copy, rename];
const triangle: Shape = { name: "triangle", next: undefined, sides: 3 };
const square: Shape = { name: "square", next: triangle, sides: 4, label: "four" };
const late: Shape = { sides: 5, name: "late", next: square };
late.label = "five";
for (const make of makers) {
  for (const shape of [triangle, square, late]) {
    const made = make(shape, "other");
    console.log(JSON.stringify(made), Object.keys(made).join(), made !== shape, made.next === shape.next);
  }
}
