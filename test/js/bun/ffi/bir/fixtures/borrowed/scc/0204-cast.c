int
main(void)
{
	static char *p = "\xe2\x80\x9c";
	unsigned n = 0;

	for (; *p; p++) {
		n <<= 1;
		if ((unsigned char)*p >= ' ' && (unsigned char)*p != 0x7f)
			n |= 1;
	}

	if (n != 7)
		return 1;

	return 0;
}
