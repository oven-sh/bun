// An abstract class and the only subclass of it that is ever created have the same instances, so both types are tested the same way. The TypeError still names the type written at the parameter that failed.
abstract class Vehicle { wheels: number = 4; }
class Car extends Vehicle { doors: number = 2; }

function takesVehicle(value: Vehicle): unknown { return value == null ? value : value.wheels; }
function takesCar(value: Car): unknown { return value == null ? value : value.doors; }
function takesVehicles(value: Vehicle[]): unknown { return value == null ? value : value.length; }
function takesCars(value: Car[]): unknown { return value == null ? value : value.length; }

function outcome(run: () => unknown): string {
  try { return "no error, " + typeof run(); } catch (error) { return (error as Error).name + ": " + (error as Error).message.replace(/ \(bun compile [^)]*\)/, ""); }
}

const parameters: [string, any][] = [["Vehicle", takesVehicle], ["Car", takesCar], ["Vehicle[]", takesVehicles], ["Car[]", takesCars]];
for (const [type, takes] of parameters) {
  console.log(type + " <- 1.5: " + outcome(() => takes(1.5)));
  console.log(type + " <- true: " + outcome(() => takes(true)));
  console.log(type + " <- undefined: " + outcome(() => takes(undefined)));
}
console.log("Vehicle <- a Car: " + outcome(() => (takesVehicle as any)(new Car())));
console.log("Car <- a Car: " + outcome(() => (takesCar as any)(new Car())));
console.log("Vehicle[] <- an array of a Car: " + outcome(() => (takesVehicles as any)([new Car()])));
console.log("Car[] <- an array of a Car: " + outcome(() => (takesCars as any)([new Car()])));
