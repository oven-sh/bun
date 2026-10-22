// ChooseRepresentations writes the form of every value and puts no conversion into the function: the code generator converts an operand in front of the operation that takes it, an argument on its edge, what a handler takes in the landing pad.
// That is the road of the functions whose code is made without the optimizing back end, so here every function goes it. A program that fails here and passes under all-code-direct shows a conversion that is missing, misplaced or made of the wrong type.
import { variant } from "./run-programs";

variant("operands-converted-at-fetch", ["--aot-testing=ConvertOperandsAtFetch", "--aot-testing=GenerateAllCodeDirectly"], {}, 2, 3);
