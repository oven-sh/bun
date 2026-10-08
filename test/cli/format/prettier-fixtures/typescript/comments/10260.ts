type A = (
    /** @deprecated */
    () => void
);
type B = (
	/** @deprecated */
	new () => void
);
type C = (
	/** @deprecated */
	<T>() => void
);
type D = (
	/** @deprecated */
	new <T>() => void
);

type A2 = (
    /** comment */
    () => void
);
type B2 = (
	/** comment */
	new () => void
);
type C2 = (
	/** comment */
	<T>() => void
);
type D2 = (
	/** comment */
	new <T>() => void
);
