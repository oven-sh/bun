export function store(object, name, value) {
  object[name] = value;
  return object[name];
}
export function open(object) {
  object.open = true;
  return object.open;
}
