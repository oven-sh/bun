struct tt { 
	int sec; 
	char *zone; 
}; 

static struct tt tt1 = {.zone = "UTC"}, *pt1 = &tt1;
static struct tt tt2, *pt2 = &tt2;

int 
main ( void )
{
	*pt2 = tt1;
	if (tt2.zone == 0)
		return 1 ;

	return 0 ;
}
