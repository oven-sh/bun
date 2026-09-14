int
main(void) {
	static struct {
		char *name;
		const int offhour;
	} tzones[] = {
		{ "CDT", -5 * 3600 },
		{ "CST", -6 * 3600 },
		{ "EDT", -4 * 3600 },
		{ "EST", -5 * 3600 },
		{ "MDT", -6 * 3600 },
		{ "MST", -7 * 3600 },
		{ "PDT", -7 * 3600 },
		{ "PST", -8 * 3600 },
	};

	if (tzones[0].offhour != -18000)
		return 1;
	if (tzones[1].offhour != -21600)
		return 2;
	if (tzones[2].offhour != -14400)
		return 3;
	if (tzones[3].offhour != -18000)
		return 4;
	if (tzones[4].offhour != -21600)
		return 5;
	if (tzones[5].offhour != -25200)
		return 6;
	if (tzones[6].offhour != -25200)
		return 7;
	if (tzones[7].offhour != -28800)
		return 8;

	return 0;
}
