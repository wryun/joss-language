Reimplementation of MATH(JOSS) in typescript (as a library).

# Immediate work

- tokeniser + recursive descent parser
- JOSS style calculator
- compat mode (Eh? / `^*` / etc.)
- Implement the language...

Use:

  # fs = filesystem abstraction - store/end
  # keyboard = JOSS/CTS/modern
  # mode = compat mode (i.e. original error messages, helpful ones...)
  joss = new JOSS(keyboard, mode, stdout, stderr, fs)
  result = joss.eval('blah\nblah\n')
  result.ok
  result.output

# Future work

- CLI frontend (Green!)
- Web frontend
- Web 'timesharing' system
- Collect example programs
- Upload CTS papers
- Profit?
