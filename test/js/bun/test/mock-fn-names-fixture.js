export function named() {}
export const bound = named.bind(null);
export const nameless = (() => function () {})();
