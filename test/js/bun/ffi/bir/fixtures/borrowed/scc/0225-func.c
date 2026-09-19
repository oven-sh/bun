int
main(void)
{
	const char *p = __func__;
	int i;

	for (i = 0; i < sizeof(__func__); i++) {
		if (p[i] != "main"[i])
			return 1;
	}
	return 0;
}
