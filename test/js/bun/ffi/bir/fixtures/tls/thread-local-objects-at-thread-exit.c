// A thread's `_Thread_local` objects are still there, holding the thread's values, when the destructors the program
// registered with pthread_key_create run at the thread's exit: whichever order the keys were made in, however the
// thread ends, and over the several rounds of destructors a key that is set again gets.
#include <pthread.h>
#include <stdio.h>

static _Thread_local int counter = 41;
static _Thread_local char text[8] = "initial";
static pthread_key_t first_key, second_key, late_key;
static int rounds_of_second;

static void first_destructor(void *value) {
  counter++;
  printf("first destructor: counter %d, text %s, value %s\n", counter, text, (const char *)value);
}
static void second_destructor(void *value) {
  counter += 10;
  printf("second destructor, round %d: counter %d\n", ++rounds_of_second, counter);
  if (rounds_of_second < 3) pthread_setspecific(second_key, value);
}
static void late_destructor(void *value) {
  (void)value;
  printf("late destructor: counter %d\n", counter);
}

static void *returns(void *argument) {
  counter = 100;
  text[0] = 'I';
  pthread_setspecific(first_key, "returned");
  pthread_setspecific(second_key, &second_key);
  return argument;
}
static void *exits(void *argument) {
  counter = 200;
  pthread_setspecific(first_key, "exited");
  pthread_exit(argument);
}
static void *makes_a_key_after_using_the_objects(void *argument) {
  counter = 300;
  pthread_key_create(&late_key, late_destructor);
  pthread_setspecific(late_key, &late_key);
  return argument;
}
static void *touches_nothing(void *argument) {
  pthread_setspecific(first_key, "untouched");
  return argument;
}

static void run(void *(*start)(void *)) {
  pthread_t thread;
  pthread_create(&thread, 0, start, 0);
  pthread_join(thread, 0);
}

int main(void) {
  pthread_key_create(&first_key, first_destructor);
  pthread_key_create(&second_key, second_destructor);
  run(returns);
  rounds_of_second = 0;
  run(exits);
  run(makes_a_key_after_using_the_objects);
  run(touches_nothing);
  printf("main thread: counter %d, text %s\n", counter, text);
  return 0;
}
