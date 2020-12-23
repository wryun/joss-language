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

    constructor(expression: string) {
        this.expression = expression;
    }

    static parse(tokens: Iterable<[Token, string]>): Command {
        return new Type(Array.from(tokens).map(([type, raw]) => raw).join(''));
    }

    /**
     * 
     * @param joss 
     * @returns line location to go to next (or null if not a goto)
     */
    eval(joss: Joss): LineLocation | null {
        joss.output(this.expression);
        joss.output('\n');
        return null;
    }
}

function parse(tokens: IterableIterator<[Token, string]>): Command {
    const {value, done} = tokens.next();

    if (done) {
        return new NoOp();
    }

    const [type, raw] = value;

    if (type !== Token.ID) {
        throw new Error('Expecting verb to start command');
    }

    switch (raw) {
        case 'Type':
            return Type.parse(tokens);
        default:
            throw new Error('Unknown verb to start command');
    }
}

enum Token {
    SPACE,
    ID,
    VAR,
    NUM,
    OP,
    STR,
    PAREN,
    STOP,
    OTHER,
}

const TOKEN_TYPES: Record<Token, RegExp> = {
    [Token.SPACE]: /\s+/,
    [Token.ID]: /(?:Type)/,
    [Token.VAR]: /[A-Za-z]\w+/,
    [Token.NUM]: /[0-9.]+/,
    [Token.OP]: /[><]=|[-+*/^=<>]/,
    [Token.STR]: /"[^"]*"/,
    [Token.PAREN]: /[()]/,
    [Token.STOP]: /[.]/,
    [Token.OTHER]: /./,
};

// Build TYPES into a set of named groups.
const TOKEN_REGEX = Object.entries(TOKEN_TYPES).map(([k, v]) => `(?<${Token[k as keyof typeof Token]}>${v.source})`).join('|');

class PeekableIterator<T> implements IterableIterator<T> {
    it: IterableIterator<T>;
    state: IteratorResult<T>;

    constructor(it: IterableIterator<T>) {
        this.it = it;
        this.state = it.next();
    }

    next(): IteratorResult<T> {
        const oldState = this.state;
        this.state = this.it.next();
        return oldState;
    }

    peek(): IteratorResult<T> {
        return this.state;
    }

    [Symbol.iterator](): IterableIterator<T> {
        return this;
    }
}

function tokenise(s: string): IterableIterator<[Token, string]> {
    return new PeekableIterator(_tokenise(s));
}

function *_tokenise(s: string): IterableIterator<[Token, string]> {
    s = s.trim();

    if (s === '' || s.startsWith('*') || s.endsWith('*')) {
        // comment form
        return;
    }

    const re = new RegExp(TOKEN_REGEX, 'y');

    let m;
    while ((m = re.exec(s)) && m.groups) {
        for (const [typeString, value] of Object.entries(m.groups)) {
            if (value !== undefined) {
                const type = Token[typeString as keyof typeof Token];
                if (type !== Token.SPACE) {
                    yield [type, value];
                }
            }
        }
    }
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