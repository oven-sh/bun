const createIdFilter =
  /** @param {string} id */
  (id) =>
  /** @param {any} s */
  (s) => s.id === id
