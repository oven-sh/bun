export function log(line) { return line.length; }
export class Sink { write(line) { return log(line); } }
export default function make() { return new Sink(); }
