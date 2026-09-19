int
main() {
	int n;
	int t;
	int c;
	int p;

	c = 0;
	n = 2;
	while (n < 5000) {
		t = 2;
		p = 1;
		while (t*t <= n) {
			if (n % t == 0)
				p = 0;
			t++;
		}
		n++;
		if (p)
			c++;
	}
	if (c != 669)
		return 1;
	return 0;
}

