struct ptrs {
	unsigned char *rp;
	unsigned char *wp;
};

struct ptrs iob[2]; 
 
int 
main() 
{
	static unsigned char buf[10];

	iob[0].rp = buf;
	iob[0].wp = buf+2;

	return (&iob[0])->rp >= (&iob[0])->wp;
}
