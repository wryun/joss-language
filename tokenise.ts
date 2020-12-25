export type {Token};
export {TokenType, TokenIterator, tokenise};

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
