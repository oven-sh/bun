/* Taken from plan9 kernel */

typedef struct Clock0link Clock0link;
typedef struct Clock0link {
	int             (*clock)(void);
	Clock0link*     link;
};

#if __STDC_VERSION__ >= 201112L
typedef struct Clock0link Clock0link;
#endif

int
f(void)
{
	return 0;
}

Clock0link cl0 = {
	.clock = f
};

int
main(void)
{
	return (*cl0.clock)();
}
