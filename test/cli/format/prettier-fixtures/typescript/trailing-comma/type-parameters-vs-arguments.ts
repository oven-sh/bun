class FooClass<
	A,
	B,
	C,
> {
	a: A;
	b: B;
	c: C;
}

const instance = new FooClass<
	boolean,
	number,
	string, // [ts] Trailing comma not allowed.
	>();
