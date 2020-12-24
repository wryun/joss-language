export {Joss};

interface Token {
    type: TokenType,
    raw: string,
}

enum TokenType {
    SPACE,
    ID,
    VAR,
    NUM,
    OP,
    STR,
    PAREN,
    COMMA,
    PERIOD,
    OTHER,
    END,
}

interface LineLocation {
    part: number;
    step: number;
}

abstract class Command {
    /**
     * 
     * @param joss 
     * @returns line location to go to next (or null if not a goto)
     */
    abstract eval(joss: Joss): LineLocation | null;

    static parse(tokens: TokenIterator<Token>): Command {
        const token = tokens.next();

        switch (token.type) {
        case TokenType.END:
            return new NoOp();
        case TokenType.ID:
            switch (token.raw) {
            case 'Type':
                return Type.parse(tokens);
            default:
                throw new Error(`${token.raw} is not a command`);
            }
        default:
            throw new Error('Expecting verb to start command');
        }
    }
}

interface Expression {
    eval(joss: Joss): string;
}

class NoOp implements Command {
    eval(joss: Joss): LineLocation | null {
        return null;
    }
}

interface BinaryOperator {
    prec: number;
    fn: (a: number, b: number) => number;
}

abstract class NumericExpression {
    abstract eval(joss: Joss): number;

    static parse(tokens: TokenIterator<Token>, precedence: number = 0): NumericExpression {
        return this.parse_binary(tokens, this.parse_unary(tokens));
    }

    static parse_unary(tokens: TokenIterator<Token>): NumericExpression {
        const token = tokens.next();
        if (token.type !== TokenType.NUM) {
            throw new Error(`Only number supported - got '${token.raw}'`);
        }

        return new NumberExpression(Number(token.raw));
    }

    static BINARY_OPERATORS: Record<string, BinaryOperator> = {
        '+': {prec: 1, fn: (a, b) => a + b},
        '-': {prec: 1, fn: (a, b) => a - b},
        '/': {prec: 2, fn: (a, b) => a / b},
        '*': {prec: 2, fn: (a, b) => a * b},
    }

    static parse_binary(tokens: TokenIterator<Token>, lhs: NumericExpression, min_prec: number = 0): NumericExpression {
        let token = tokens.peek();
        let current: BinaryOperator;
        let next: BinaryOperator;
        let rhs: NumericExpression;

        // From wikipedia's 'Precedence Climbing' pseudocode: https://en.wikipedia.org/wiki/Operator-precedence_parser
        while (token.type === TokenType.OP && (current = this.BINARY_OPERATORS[token.raw]).prec >= min_prec) {
            tokens.next();
            rhs = this.parse_unary(tokens);
            while ((token = tokens.peek()).type === TokenType.OP && (next = this.BINARY_OPERATORS[token.raw]).prec > current.prec) {
                rhs = this.parse_binary(tokens, rhs, next.prec);
            }
            lhs = new BinaryNumericExpression(current.fn, lhs, rhs);
        }

        return lhs;
    }
}

class NumberExpression implements NumericExpression {
    num: number;

    constructor(num: number) {
        this.num = num;
    }

    eval(joss: Joss): number {
        return this.num;
    }
}

class BinaryNumericExpression implements NumericExpression {
    fn: (a: number, b: number) => number;
    lhs: NumericExpression;
    rhs: NumericExpression;

    constructor(fn: (a: number, b: number) => number, lhs: NumericExpression, rhs: NumericExpression) {
        this.fn = fn;
        this.lhs = lhs;
        this.rhs = rhs;
    }

    eval(joss: Joss): number {
        return this.fn(this.lhs.eval(joss), this.rhs.eval(joss));
    }
}

class Maths implements Expression {
    expression: NumericExpression;

    constructor(expr: NumericExpression) {
        this.expression = expr;
    }

    eval(joss: Joss): string {
        return this.expression.eval(joss).toString();
    }

    static parse(tokens: TokenIterator<Token>): Maths {
        return new Maths(NumericExpression.parse(tokens));
    }
}

class String implements Expression {
    val: string;

    constructor(val: string) {
        this.val = val;
    }

    eval(joss: Joss): string {
        return this.val;
    }

    static parse(tokens: TokenIterator<Token>): String {
        const token = tokens.next();
        // assert type === TokenType.STR
        return new String(token.raw.slice(1, -1));
    }
}

class Type implements Command {
    expressions: Array<Expression>;

    constructor(expressions: Array<Expression>) {
        this.expressions = expressions;
    }

    // ? Can't use TokenType here, because then we have to define _all_ token types for the object...
    static parseDecision: Record<number, (tokens: TokenIterator<Token>) => Expression> = {
        [TokenType.VAR]: Maths.parse,
        [TokenType.NUM]: Maths.parse,
        [TokenType.OP]: Maths.parse,
        [TokenType.STR]: String.parse,
        [TokenType.PAREN]: Maths.parse,
    };

    static parse(tokens: TokenIterator<Token>): Type {
        const expressions: Array<Expression> = [];

        let token;
        do {
            token = tokens.peek();
            const parseFn = this.parseDecision[token.type];
            if (parseFn === undefined) {
                throw new Error(`Can\'t type ${token.raw}`)
            }
            expressions.push(parseFn(tokens));
            token = tokens.peek();
            if (token.type !== TokenType.COMMA) {
                break;
            }
            token = tokens.next();
        } while (true);

        return new Type(expressions);
    }

    eval(joss: Joss): LineLocation | null {
        for (const e of this.expressions) {
            joss.output(e.eval(joss));
            joss.output('\n');
        }
        return null;
    }
}

function parse(tokens: TokenIterator<Token>): Command {
    const command = Command.parse(tokens);

    // modifiers

    // check that PERIOD is there

    return command;
}

const TOKEN_TYPES: Record<TokenType, RegExp> = {
    [TokenType.SPACE]: /\s+/,
    [TokenType.ID]: /(?:Type)/,
    [TokenType.VAR]: /[A-Za-z]\w+/,
    [TokenType.NUM]: /[0-9.]+/,
    [TokenType.OP]: /[><]=|[-+*/^=<>]/,
    [TokenType.STR]: /".*"/, // Oddly, this greedy behaviour for double quotes is correct.
    [TokenType.PAREN]: /[()]/,
    [TokenType.COMMA]: /,/,
    [TokenType.PERIOD]: /[.]/,
    [TokenType.OTHER]: /./,
    [TokenType.END]: /impossible/,
};

// Build TYPES into a set of named groups.
const TOKEN_REGEX = Object.entries(TOKEN_TYPES).map(([k, v]) => `(?<${TokenType[k as keyof typeof TokenType]}>${v.source})`).join('|');

class TokenIterator<T> {
    it: Iterator<T>;
    state: T;

    constructor(it: Iterator<T>) {
        this.it = it;
        this.state = this._next();
    }

    _next(): T {
        const {value, done} = this.it.next();
        return done ? {type: TokenType.END, raw: ''} : value;
    }

    next(): T {
        const oldState = this.state;            
        this.state = this._next();
        return oldState;

    }

    peek(): T {
        return this.state;
    }
}

function tokenise(s: string): TokenIterator<Token> {
    return new TokenIterator(_tokenise(s));
}

function *_tokenise(s: string): Iterator<Token> {
    s = s.trim();

    if (s === '' || s.startsWith('*') || s.endsWith('*')) {
        // comment form
        return;
    }

    const re = new RegExp(TOKEN_REGEX, 'y');

    let m;
    while ((m = re.exec(s)) && m.groups) {
        for (const [typeString, raw] of Object.entries(m.groups)) {
            if (raw !== undefined) {
                const type = TokenType[typeString as keyof typeof TokenType];
                if (type !== TokenType.SPACE) {
                    yield {type, raw};
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
