enum e {
	C1,
	C2,
};

int
main(void)
{
	enum e v = C2;

	return v == 0 ? 1 : 0;
}
