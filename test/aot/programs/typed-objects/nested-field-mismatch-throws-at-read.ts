// An object from untyped code holds another one, and both are used through declared types. Any object passes the check at a parameter and stays as it is, also one that is the prototype of another object. A nested field of another type throws at the first typed read of that field, a nested object that is missing reads as undefined, and a field that is never read is never checked.
interface Gadget { serial: string; vendor?: string }
interface Crate { labels: string[]; gadget: Gadget }
interface Shipment { id: number; crate: Crate }

function describeCrate(crate: Crate): string { return crate.labels.join() + " " + crate.gadget.serial }
function describeShipment(shipment: Shipment): string { return shipment.id + " " + describeCrate(shipment.crate) }
const gadgets: any[] = [];
function untypedGadget(): any { const gadget: any = {}; gadget.serial = "s-1"; gadgets.push(gadget); return gadget }
function attempt(name: string, f: () => string): void {
  try { console.log(name, f()) } catch (e) { const message = (e as Error).message, note = message.indexOf(" (bun compile checks types"); console.log(name, (e as Error).name + (note < 0 ? "" : ": " + message.slice(0, note))) }
}

const known: Shipment = { id: 1, crate: { labels: ["known"], gadget: { serial: "s-0", vendor: "v" } } };
attempt("created by typed code:", () => describeShipment(known));

attempt("a prototype, one level down:", () => {
  const gadget = untypedGadget();
  const heir = Object.create(gadget);
  const crate: any = { labels: ["a"], gadget };
  return describeCrate(crate) + " " + heir.serial;
});

attempt("a prototype, two levels down:", () => {
  const gadget = untypedGadget();
  const heir = Object.create(gadget);
  const shipment: any = { id: 2, crate: { labels: ["b"], gadget } };
  return describeShipment(shipment) + " " + heir.serial;
});

attempt("a field of another type, one level down:", () => {
  const gadget = untypedGadget();
  gadget.serial = 7;
  const crate: any = { labels: ["c"], gadget };
  return describeCrate(crate);
});

attempt("a field of another type, two levels down:", () => {
  const gadget = untypedGadget();
  gadget.serial = 7;
  const shipment: any = { id: 3, crate: { labels: ["d"], gadget } };
  return describeShipment(shipment);
});

attempt("a nested object is missing:", () => {
  const shipment: any = { id: 4, crate: { labels: ["e"] } };
  return describeShipment(shipment);
});

attempt("a field of another type, not read:", () => {
  const gadget = untypedGadget();
  gadget.vendor = 9;
  const crate: any = { labels: ["f"], gadget };
  return describeCrate(crate);
});

console.log("the objects afterwards:", gadgets.map(gadget => Object.keys(gadget).join() + " " + typeof gadget.serial).join(", "));
