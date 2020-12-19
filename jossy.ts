export {};

interface LineLocation {
    part: number;
    step: number;
}

interface Command {
    eval(joss: Joss): LineLocation | null;
}

class NoOp implements Command {
    eval(joss: Joss): LineLocation | null {
        return null;
    }
}

class Type implements Command {
    expression: string;

    constructor(tokens: Iterable<string>) {
        this.expression = '';
        for (const token of tokens) {
            this.expression += token;
        }
    }

    /**
     * 
     * @param joss 
     * @returns line location to go to next (or null if not a goto)
     */
    eval(joss: Joss): LineLocation | null {
        joss.output(this.expression);
        return null;
    }
}

function parse(tokens: IterableIterator<string>): Command {
    const {value, done} = tokens.next();

    if (done) {
        return new NoOp();
    }

    switch (value) {
        case 'Type':
            return new Type(tokens);
        case '':
            return new NoOp();
        default:
            throw new Error(`Verb not supported: ${value}`);
    }
}

function *tokenise(s: string): IterableIterator<string> {
    s = s.trim();

    if (s === '' || s.startsWith('*') || s.endsWith('*')) {
        // comment form
        return;
    }

    if (!s.endsWith('.')) {
        throw new Error('Command must end with ".".');
    }

    let match;
    while (s !== '') {
      if (match = s.match(/[A-Za-z]:/) {
      }
    }

    /(\S+)(\s+(.*))?\.$/.match(s):
    yield *s.split(' ');
}

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

new Joss(Deno.stdin, Deno.stdout).eval(`
Type "This is the troof".
Type "That is the troof".
`);

Deno.exit();