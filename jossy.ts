export {Joss};

import { parse } from './parse.ts';
import { tokenise } from './tokenise.ts';


class Joss {
    stdout: any;
    stdin: any;
    program: object; // {1: {1: {raw, tokens}}}

    constructor(stdin: Deno.Reader, stdout: Deno.Writer) {
        this.stdout = stdout;
        this.stdin = stdin;
        this.program = {};
    }

    output(s: string) {
        Deno.writeAllSync(this.stdout, new TextEncoder().encode(s));
    }

    eval(s: string) {
        for (const input of s.split('\n')) {
            this.eval_input_line(input);
        }
    }

    private eval_input_line(s: string) {
        // check if it starts with a number; if so, place in program... (and parse)
        this.eval_line(s);
    }

    private eval_line(s: string) {
        parse(tokenise(s)).eval(this);
    }
}
