struct f {
	int fd;
        unsigned char *buf;
        unsigned char unbuf[1];
	unsigned char *rp;
};

#define stderr (&buf[2])

struct f f;

struct f buf[] = {
	{
		.fd = 0,
	},
	{
		.fd = -1,
		.buf = f.unbuf,
	},
	{
		.fd = 2,
		.buf = stderr->unbuf,
		.rp = stderr->unbuf,
	},
};

int
main()
{
	if (buf[2].unbuf != buf[2].rp)
		return 1;
	if (buf[2].unbuf != buf[2].buf)
		return 2;
	if (buf[1].buf != f.unbuf)
		return 3;
	return 0;
}
