import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("seq", async () => {
  TestBuilder.command`seq`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage");

  TestBuilder.command`seq -w`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only -w flag given");

  TestBuilder.command`seq --fixed-width`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only --fixed-width flag given");

  TestBuilder.command`seq -s ,`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only -s flag given");

  TestBuilder.command`seq -t ,`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only -t flag given");

  TestBuilder.command`seq -w -s , -t .`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only flags given");

  TestBuilder.command`seq -s`
    .exitCode(1)
    .stdout("")
    .stderr("seq: option requires an argument -- s\n")
    .runAsTest("tests -s");

  TestBuilder.command`seq -t`
    .exitCode(1)
    .stdout("")
    .stderr("seq: option requires an argument -- t\n")
    .runAsTest("tests -s");

  TestBuilder.command`seq 0 5`.exitCode(0).stdout("0\n1\n2\n3\n4\n5\n").stderr("").runAsTest("works basic up");

  TestBuilder.command`seq 5 0`.exitCode(0).stdout("5\n4\n3\n2\n1\n0\n").stderr("").runAsTest("works basic down");

  TestBuilder.command`seq -s, 0 5`.exitCode(0).stdout("0,1,2,3,4,5,").stderr("").runAsTest("-s works inline");

  TestBuilder.command`seq -s , 0 5`.exitCode(0).stdout("0,1,2,3,4,5,").stderr("").runAsTest("-s works separate");

  TestBuilder.command`seq --separator , 0 5`
    .exitCode(0)
    .stdout("0,1,2,3,4,5,")
    .stderr("")
    .runAsTest("--separator works");

  TestBuilder.command`seq -t, 0 5`.exitCode(0).stdout("0\n1\n2\n3\n4\n5\n,").stderr("").runAsTest("-t works inline");

  TestBuilder.command`seq -t , 0 5`.exitCode(0).stdout("0\n1\n2\n3\n4\n5\n,").stderr("").runAsTest("-t works separate");

  TestBuilder.command`seq --terminator , 0 5`
    .exitCode(0)
    .stdout("0\n1\n2\n3\n4\n5\n,")
    .stderr("")
    .runAsTest("--terminator works");

  TestBuilder.command`seq -s. -t, 0 5`
    .exitCode(0)
    .stdout("0.1.2.3.4.5.,")
    .stderr("")
    .runAsTest("-s and -t work together");

  TestBuilder.command`seq 0`.exitCode(0).stdout("1\n0\n").stderr("").runAsTest("seq 0");

  TestBuilder.command`seq 1`.exitCode(0).stdout("1\n").stderr("").runAsTest("seq 1");

  TestBuilder.command`seq 2`.exitCode(0).stdout("1\n2\n").stderr("").runAsTest("seq 2");

  TestBuilder.command`seq 8 8`.exitCode(0).stdout("8\n").stderr("").runAsTest("same start and end");

  TestBuilder.command`seq ab`.exitCode(1).stdout("").stderr("seq: invalid argument\n").runAsTest("invalid arg 1");

  TestBuilder.command`seq 4 ab`.exitCode(1).stdout("").stderr("seq: invalid argument\n").runAsTest("invalid arg 2");

  TestBuilder.command`seq 4 7 ba`.exitCode(1).stdout("").stderr("seq: invalid argument\n").runAsTest("invalid arg 3");

  TestBuilder.command`seq 0x10 0x10`.exitCode(0).stdout("16\n").stderr("").runAsTest("hex arg");

  TestBuilder.command`seq 0X10 0X10`.exitCode(0).stdout("16\n").stderr("").runAsTest("hex arg uppercase prefix");

  TestBuilder.command`seq 0x1p4 0x1p4`.exitCode(0).stdout("16\n").stderr("").runAsTest("hex float with p exponent");

  TestBuilder.command`seq 0x1.8p1 0x1.8p1`.exitCode(0).stdout("3\n").stderr("").runAsTest("hex float with fraction");

  TestBuilder.command`seq -0x3 0x2 0x3`
    .exitCode(0)
    .stdout("-3\n-1\n1\n3\n")
    .stderr("")
    .runAsTest("hex in start/increment/end with sign");

  TestBuilder.command`seq 1_0 1_0`.exitCode(0).stdout("10\n").stderr("").runAsTest("underscore digit separator");

  TestBuilder.command`seq 0x1_0 0x1_0`
    .exitCode(0)
    .stdout("16\n")
    .stderr("")
    .runAsTest("underscore digit separator in hex");

  TestBuilder.command`seq 0x0p1024 0x0p1024`
    .exitCode(0)
    .stdout("0\n")
    .stderr("")
    .runAsTest("hex zero with out-of-range exponent");

  TestBuilder.command`seq 0x0p9999999999 0x0p9999999999`
    .exitCode(0)
    .stdout("0\n")
    .stderr("")
    .runAsTest("hex zero with exponent past i32 range");

  TestBuilder.command`seq 0x1p-9999999999 0x1p-9999999999`
    .exitCode(0)
    .stdout("0\n")
    .stderr("")
    .runAsTest("hex with huge negative exponent underflows to zero");

  TestBuilder.command`seq 0x`.exitCode(1).stdout("").stderr("seq: invalid argument\n").runAsTest("bare 0x is invalid");

  TestBuilder.command`seq 0xg`
    .exitCode(1)
    .stdout("")
    .stderr("seq: invalid argument\n")
    .runAsTest("non-hex digit after 0x is invalid");

  TestBuilder.command`seq 0x0p`
    .exitCode(1)
    .stdout("")
    .stderr("seq: invalid argument\n")
    .runAsTest("hex p with no exponent is invalid");

  TestBuilder.command`seq 0x0pZ`
    .exitCode(1)
    .stdout("")
    .stderr("seq: invalid argument\n")
    .runAsTest("non-digit hex exponent is invalid");

  TestBuilder.command`seq _1`
    .exitCode(1)
    .stdout("")
    .stderr("seq: invalid argument\n")
    .runAsTest("leading underscore is invalid");

  TestBuilder.command`seq 1_`
    .exitCode(1)
    .stdout("")
    .stderr("seq: invalid argument\n")
    .runAsTest("trailing underscore is invalid");

  TestBuilder.command`seq 1__0`
    .exitCode(1)
    .stdout("")
    .stderr("seq: invalid argument\n")
    .runAsTest("consecutive underscores are invalid");

  TestBuilder.command`seq 0x_10`
    .exitCode(1)
    .stdout("")
    .stderr("seq: invalid argument\n")
    .runAsTest("underscore after hex prefix is invalid");

  TestBuilder.command`seq 4 0 7`.exitCode(1).stdout("").stderr("seq: zero increment\n").runAsTest("zero increment");

  TestBuilder.command`seq 4 -2 7`
    .exitCode(1)
    .stdout("")
    .stderr("seq: needs positive increment\n")
    .runAsTest("needs positive increment");

  TestBuilder.command`seq 7 2 4`
    .exitCode(1)
    .stdout("")
    .stderr("seq: needs negative decrement\n")
    .runAsTest("needs negative decrement");

  TestBuilder.command`seq 16777216 16777218`
    .exitCode(0)
    .stdout("16777216\n")
    .stderr("")
    .runAsTest("terminates when adding the increment no longer changes the value");

  TestBuilder.command`seq 1 0.00000001 2`
    .exitCode(0)
    .stdout("1\n")
    .stderr("")
    .runAsTest("terminates when the increment is too small to advance the accumulator");
});

describe("seq without stdout", async () => {
  TestBuilder.command`echo $(seq 0 5)`
    .exitCode(0)
    .stdout("0 1 2 3 4 5\n")
    .stderr("")
    .runAsTest("works basic up without stdout");

  TestBuilder.command`echo $(seq 5 0)`
    .exitCode(0)
    .stdout("5 4 3 2 1 0\n")
    .stderr("")
    .runAsTest("works basic down without stdout");
});
