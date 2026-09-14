int
main(void)
{
	unsigned char uc;
	signed char sc;

	uc = -1;
	if ((uc & 0xFF) != 0xFF)
		return 1;

	uc = '\x23';
	if (uc != 35)
		return 2;

	uc = 1u;
	if (uc != (1025 & 0xFF))
		return 1;

	uc = 'A';
	if (uc != 0x41)
		return 3;

	sc = -1;
	if ((sc & 0xFF) != 0xFF)
		return 4;

	sc = '\x23';
	if (sc != 35)
		return 5;

	sc = 1u;
	if (sc != (1025 & 0xFF))
		return 6;

	sc = 'A';
	if (sc != 0x41)
		return 7;

	return 0;
}
