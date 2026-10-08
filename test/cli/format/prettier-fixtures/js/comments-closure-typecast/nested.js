foo = /** @type {!Foo} */ (/** @type {!Baz} */ (baz).bar );

const BarImpl = /** @type {BarConstructor} */ (
	/** @type {unknown} */
	(function Bar() {
		throw new Error("Internal error: Illegal constructor");
	})
);
