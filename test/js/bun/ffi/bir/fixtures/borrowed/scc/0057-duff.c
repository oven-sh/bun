int main()
{
	int  count, n;
	char *from, *to;
	char a[39], b[39];

	for(n = 0; n < 39; n++) {
		a[n] = n;
		b[n] = 0;
	}
	from = a;
	to = b;
	count = 39;
	n = (count + 7) / 8;
	switch (count % 8) {
	case 0: do { *to++ = *from++;
	case 7:      *to++ = *from++;
	case 6:      *to++ = *from++;
	case 5:      *to++ = *from++;
	case 4:      *to++ = *from++;
	case 3:      *to++ = *from++;
	case 2:      *to++ = *from++;
	case 1:      *to++ = *from++;
			} while (--n > 0);
	}
	for(n = 0; n < 39; n++)
		if(a[n] != b[n])
			return 1;
	return 0;
}
