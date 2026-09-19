typedef unsigned int sigset_t ; 
typedef struct siginfo siginfo_t ; 

struct sigaction { 
	union { 
		void (*__sa_handler)(int); 
		void (*__sa_sigaction)(int, siginfo_t *, void *) ; 
	} __sigaction_u ; 

	sigset_t sa_mask ; 
	int sa_flags ; 
};

static int
_sigaction(int num, struct sigaction *sa, struct sigaction *osa)
{
	return num != 3 ? -1 : 0;
}

static void
(*signal(int signum, void (* func) (int)))(int) 
{
	struct sigaction osa , sa = { 
		.__sigaction_u.__sa_handler = func, 
	}; 

	if (_sigaction(signum, &sa, &osa ) < 0 ) 
		return ((void (*)(int)) -1) ; 

	return osa.__sigaction_u.__sa_handler ; 
}

static void
sighdl(int signo)
{
}

int
main(void)
{
	signal(3, sighdl);

	return 0;
}
