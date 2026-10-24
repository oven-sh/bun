function helper() { return "helper of the generator"; }
export default async function* () { yield helper(); }
