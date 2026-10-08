a =
  (id) => // 11
	(id) => id
a =
  (id) =>
  // 12
	(id) => id

a =
  (id) => // 21
	{}
a =
  (id) =>
  // 22
	{}

a =
  (id) => // 21
	{call()}
a =
  (id) =>
  // 22
	{call()}

a =
  () => // 31
	(id) => id
a =
  () =>
  // 32
	(id) => id

a =
  (id) => /** @param {string} id */
	(id) => id

a =
  (id) =>
  /** @param {string} id */
	(id) => id

a =
  (id) =>
  /** @param {string} id */ (id) => id

a =
  () => /** @param {string} id */
	(id) => id

a =
  () =>
  /** @param {string} id */
	(id) => id

a =
  () =>
  /** @param {string} id */ (id) => id
