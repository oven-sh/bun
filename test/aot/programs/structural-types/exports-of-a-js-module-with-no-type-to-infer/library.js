export let current;
export let nothing = null;
export var later = undefined;
export const list = [];
export const bag = {};

export function setCurrent(value) {
  current = value;
}

export function setNothing(value) {
  nothing = value;
}

export function setLater(value) {
  later = value;
}

export const table = Object.create(null);
table.first = 1;
