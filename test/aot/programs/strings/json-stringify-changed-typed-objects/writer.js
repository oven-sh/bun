export function write(value, replacer, indent) {
  try {
    return String(JSON.stringify(value, replacer, indent));
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}
