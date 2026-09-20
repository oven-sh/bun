#include <stdint.h>

int
main()
{
	int32_t x;
	int64_t l;
	
	x = 0;
	l = 0;
	
	x = ~x;
	if (x != 0xffffffff)
		return 1;
	
	l = ~l;
	if (x != 0xffffffffffffffff)
		return 2;

	
	return 0;
}
