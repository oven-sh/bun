interface Planet {
  label: string;
}
function read(planet: Planet): string {
  const bag = { held: planet };
  let built = "";
  for (let i = 0; i < 3; i++) built += bag.held.label;
  return built;
}
const honest: Planet = { label: "ab" };
console.log("honest " + read(honest));
const victim: Planet = { label: "ab" };
const wide: { label: unknown } = victim;
wide.label = Object(3);
console.log("victim " + read(victim));
