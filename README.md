# MATH(JOSS)

WIP Reimplementation of MATH(JOSS) in typescript.

This is IBM's version of the JOSS language, written for
the System/360. It's also referred to as MATH or MATH/360.
It's probably very similar to normal JOSS, but I'm using
the IBM reference manual, so...

Currently, only some basic constructs are implemented
(expression evaluation, Type/Set/Do/if/for/times).
`tests/` roughly tracks what should currently work.

At the moment, it's not as restrictive as the original:

- slightly more helpful errors
- allows multi-char identifiers
- more relaxed about spaces in expressions
- no 10 dimension/10 argument limit on arrays
- javascript floats (i.e. greater range/precision)

But, error handling also needs work (e.g. type safety
rather than casting everywhere and hoping for the best).
