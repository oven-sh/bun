// A value that does not fit is named by its property path in the error message. An object that fits but cannot be converted in place, here the prototype of another, is no error: it stays as it is.
interface Gadget { serial: string; vendor?: string }
interface Crate { labels: string[]; gadget: Gadget }
interface Shipment { id: number; crate: Crate }

function describeCrate(crate: Crate): string { return crate.labels.join() + " " + crate.gadget.serial }
function describeShipment(shipment: Shipment): string { return shipment.id + " " + describeCrate(shipment.crate) }
function untypedGadget(): any { const gadget: any = {}; gadget.serial = "s-1"; return gadget }
function firstLines(f: () => string): string {
  try { return f() } catch (e) { return e instanceof Error ? e.name + ": " + e.message.split("\n").slice(0, 2).map(line => line.replace(/ \(bun --aot: [^)]*\)/, "").trim()).join(" | ").split(", and a copy")[0] : String(e) }
}

const known: Shipment = { id: 1, crate: { labels: ["known"], gadget: { serial: "s-0", vendor: "v" } } };
console.log(describeShipment(known));

console.log(firstLines(() => {
  const gadget = untypedGadget();
  const heir = Object.create(gadget);
  const crate: any = { labels: ["a"], gadget };
  return describeCrate(crate) + " " + heir.serial;
}));

console.log(firstLines(() => {
  const gadget = untypedGadget();
  const heir = Object.create(gadget);
  const shipment: any = { id: 2, crate: { labels: ["b"], gadget } };
  return describeShipment(shipment) + " " + heir.serial;
}));

console.log(firstLines(() => {
  const gadget = untypedGadget();
  gadget.serial = 7;
  const crate: any = { labels: ["c"], gadget };
  return describeCrate(crate);
}));

console.log(firstLines(() => {
  const gadget = untypedGadget();
  gadget.serial = 7;
  const shipment: any = { id: 3, crate: { labels: ["d"], gadget } };
  return describeShipment(shipment);
}));

console.log(firstLines(() => {
  const shipment: any = { id: 4, crate: { labels: ["e"] } };
  return describeShipment(shipment);
}));
