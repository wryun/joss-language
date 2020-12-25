import { expandGlobSync } from "https://deno.land/std@0.82.0/fs/mod.ts";
import { assertEquals } from "https://deno.land/std@0.82.0/testing/asserts.ts";

import { Joss } from './jossy.ts';

const decoder = new TextDecoder();


for (const file of expandGlobSync("tests/*.session")) {
  Deno.test(file.name, () => {
    const output = new Deno.Buffer();
    const joss = new Joss(Deno.stdin, output);

    let expected = '';
    for (const line of Deno.readTextFileSync(file.path).split('\n')) {
      if (line.startsWith('> ')) {
        expected += line.slice(2) + '\n';
        continue;
      }

      if (expected != '') {
        assertEquals(decoder.decode(Deno.readAllSync(output)), expected);
        expected = '';
      }
      joss.eval(line);
    }
  });
}
