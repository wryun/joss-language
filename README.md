# MATH(JOSS)

WIP Reimplementation of MATH(JOSS) in typescript.

This is IBM's version of the JOSS language.

Currently, only some basic constructs are implemented
(expression evaluation, Type/Set/Do/if/for/times).
`tests/` roughly tracks what should currently work.

At the moment, it's not as restrictive as the original:

- slightly more helpful errors
- allows multi-char identifiers
- more relaxed about spaces in expressions
- no 10 dimension/10 argument limit on arrays

But, error handling also needs work (e.g. type safety
rather than casting everywhere and hoping for the best).
