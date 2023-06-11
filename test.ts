import { expandGlobSync } from "https://deno.land/std@0.82.0/fs/mod.ts";
import { assertEquals } from "https://deno.land/std@0.82.0/testing/asserts.ts";

import { Joss } from './joss.ts';

const decoder = new TextDecoder();

function *get_tests() {
  for (const file of expandGlobSync("tests/*.session")) {
    let expected = '';
    let lineno = 0;
    let command = '';
    let command_lineno = 0;
    for (const line of Deno.readTextFileSync(file.path).split('\n')) {
      lineno += 1;
      if (line.startsWith('#')) {
        continue;
      }
      if (!line.startsWith('> ')) {
        expected += line + '\n';
        continue;
      }

      if (command !== '') {
        yield {fname: file.name, command_lineno, command, expected};
      }
      command = line.slice(2);
      command_lineno = lineno;
      expected = '';
    }

    yield {fname: file.name, command_lineno, command, expected};
  }
}

let old_fname: string|null = null;
const output = new Deno.Buffer();
let joss = new Joss(Deno.stdin, output);

for (const {fname, command_lineno, command, expected} of get_tests()) {
  if (old_fname && old_fname !== fname) {
    joss = new Joss(Deno.stdin, output);
    old_fname = fname;
  }

  Deno.test(`${fname}: ${command_lineno}: ${command}`, () => {
    joss.eval(command);
    assertEquals(decoder.decode(Deno.readAllSync(output)), expected);
  });
}
