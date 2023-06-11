export {parse};

import { Token, TokenType, TokenIterator } from './tokenise.ts';
import { Joss, Result } from './jossy.ts';

function expect(context: string, t: Token, type: TokenType, raw: (string|null) = null): Token {
    const matches = t.type === type && (raw === null || t.raw === raw);
    if (!matches) {
        throw new Error(`${context}: expected ${type}${raw ? ` "${raw}"` : ''}, got ${JSON.stringify(t)}`);
    }
    return t;
}

interface LineLocation {
    part: number;
    step: number;
}

class Command {
    verb: Verb;
    ifmodifier: If|null;

    constructor(verb: Verb, ifmodifier: If|null = null) {
        this.verb = verb;
        this.ifmodifier = ifmodifier;
    }

    /**
     * 
     * @param joss 
     * @returns line location to go to next (or null if not a goto)
     */
    eval(joss: Joss): LineLocation | null {
        if (!this.ifmodifier || this.ifmodifier.eval(joss)) {
            return this.verb.eval(joss);
        } else {
            return null;
        }
    }

    static parse(tokens: TokenIterator<Token>): Command {
        const token = tokens.next();
        let verb;

        switch (token.type) {
        case TokenType.END:
            verb = new NoOp();
            break;
        case TokenType.ID:
            switch (token.raw) {
            case 'Type':
                verb = Type.parse(tokens);
                break;
            case 'Set':
                verb = Set.parse(tokens);
                break;
            default:
                throw new Error(`${token.raw} is not a command`);
            }
            break;
        default:
            throw new Error('Expecting verb to start command');
        }

        return new Command(verb, tokens.peek().raw === 'if' ? If.parse(tokens) : null);
    }
}

interface StringExpression {
    eval(joss: Joss): string;
}

class If {
    expression: Expression;

    constructor(expression: Expression) {
        this.expression = expression;
    }

    eval(joss: Joss): boolean {
        // TODO boolean types...
        return Boolean(this.expression.eval(joss));
    }

    static parse(tokens: TokenIterator<Token>): If {
        expect('', tokens.next(), TokenType.VAR, 'if');

        // TODO distinguish types properly.
        return new If(Expression.parse(tokens));
    }
}

abstract class Verb {
    /**
     * 
     * @param joss 
     * @returns line location to go to next (or null if not a goto)
     */
    abstract eval(joss: Joss): LineLocation | null;
}

class NoOp implements Verb {
    eval(joss: Joss): LineLocation | null {
        return null;
    }
}

interface BinaryOperator {
    prec: number;
    fn: (a: Result, b: Result) => Result;
}

abstract class Expression {
    abstract eval(joss: Joss): Result;

    static parse(tokens: TokenIterator<Token>): Expression {
        return this.parse_binary(tokens, this.parse_unary(tokens));
    }

    static parse_unary(tokens: TokenIterator<Token>): Expression {
        const token = tokens.peek();
        let result;
        switch (token.type) {
            case TokenType.NUM:
                return NumberExpression.parse(tokens);
            case TokenType.VAR:
                return VariableExpression.parse(tokens);
            case TokenType.PAREN:
                expect('Invalid parenthesis', tokens.next(), TokenType.PAREN, '(');
                result = this.parse_binary(tokens, this.parse_unary(tokens));
                expect('Invalid parenthesis', tokens.next(), TokenType.PAREN, ')');
                return result;
            default:
                throw new Error(`Unexpected token in numeric expression: got '${token.raw}'`);
        }
    }

    // TODO error out on conversions (replace with assert);
    // operator precedence.
    static BINARY_OPERATORS: Record<string, BinaryOperator> = {
        'or': {prec: 0, fn: (a, b) => Boolean(a) && Boolean(b)},
        'and': {prec: 1, fn: (a, b) => Boolean(a) && Boolean(b)},
        '==': {prec: 2, fn: (a, b) => a == b},
        '!=': {prec: 2, fn: (a, b) => a != b},
        '<': {prec: 3, fn: (a, b) => Number(a) < Number(b)},
        '>': {prec: 3, fn: (a, b) => Number(a) > Number(b)},
        '<=': {prec: 3, fn: (a, b) => Number(a) <= Number(b)},
        '>=': {prec: 3, fn: (a, b) => Number(a) >= Number(b)},
        '+': {prec: 4, fn: (a, b) => Number(a) + Number(b)},
        '-': {prec: 4, fn: (a, b) => Number(a) - Number(b)},
        '/': {prec: 5, fn: (a, b) => Number(a) / Number(b)},
        '*': {prec: 5, fn: (a, b) => Number(a) * Number(b)},
    }

    static parse_binary(tokens: TokenIterator<Token>, lhs: Expression, min_prec = 0): Expression {
        let token = tokens.peek();
        let current: BinaryOperator;
        let next: BinaryOperator;
        let rhs: Expression;

        // From wikipedia's 'Precedence Climbing' pseudocode: https://en.wikipedia.org/wiki/Operator-precedence_parser
        while (token.type === TokenType.OP && (current = this.BINARY_OPERATORS[token.raw]).prec >= min_prec) {
            tokens.next();
            rhs = this.parse_unary(tokens);
            while ((token = tokens.peek()).type === TokenType.OP && (next = this.BINARY_OPERATORS[token.raw]).prec > current.prec) {
                rhs = this.parse_binary(tokens, rhs, next.prec);
            }
            lhs = new BinaryExpression(current.fn, lhs, rhs);
        }

        return lhs;
    }
}

// Oddly, our 'Variable' also includes its arguments
// (i.e. if it's an array or function that's resolving to something).
class VariableExpression implements Expression {
    v: string;
    indices: Expression[];

    constructor(v: string, indices: Array<Expression>) {
        this.v = v;
        this.indices = indices;
    }

    eval(joss: Joss): Result {
        const res = joss.get(this.v);
        if (res instanceof Function && this.indices.length > 0) {
            return res(...this.indices.map(i => i.eval(joss)));
        } else {
            return res;
        }
    }

    eval_set(joss: Joss, value: Result) {
        if (this.indices.length > 0) {
            joss.setArray(this.v, this.indices.map(i => Number(i.eval(joss))), value);
        } else if (typeof value === 'boolean' || typeof value === 'number') {
            joss.setVariable(this.v, value);
        } else {
            joss.setFunction(this.v, value);
        }
    }

    static parse(tokens: TokenIterator<Token>): VariableExpression {
        const v = tokens.next().raw;
        const indices: Array<Expression> = [];

        let token = tokens.peek();
        if (!(token.type === TokenType.PAREN && token.raw === '(')) {
            return new VariableExpression(v, indices);
        }

        tokens.next();

        while (true) {
            indices.push(Expression.parse(tokens));

            token = tokens.next();
            if (token.raw === ')') {
                break;
            }
            expect('matrix index', token, TokenType.COMMA);
        }

        return new VariableExpression(v, indices);
    }
}

class NumberExpression implements Expression {
    num: number;

    constructor(num: number) {
        this.num = num;
    }

    eval(joss: Joss): number {
        return this.num;
    }

    static parse(tokens: TokenIterator<Token>): NumberExpression {
        return new NumberExpression(Number(tokens.next().raw));
    }
}

class BinaryExpression implements Expression {
    fn: (a: Result, b: Result) => Result;
    lhs: Expression;
    rhs: Expression;

    constructor(fn: (a: Result, b: Result) => Result, lhs: Expression, rhs: Expression) {
        this.fn = fn;
        this.lhs = lhs;
        this.rhs = rhs;
    }

    eval(joss: Joss): Result {
        return this.fn(this.lhs.eval(joss), this.rhs.eval(joss));
    }
}

class Maths implements StringExpression {
    expression: Expression;

    constructor(expr: Expression) {
        this.expression = expr;
    }

    eval(joss: Joss): string {
        return this.expression.eval(joss).toString();
    }

    static parse(tokens: TokenIterator<Token>): Maths {
        return new Maths(Expression.parse(tokens));
    }
}

class QuotedString implements StringExpression {
    val: string;

    constructor(val: string) {
        this.val = val;
    }

    eval(joss: Joss): string {
        return this.val;
    }

    static parse(tokens: TokenIterator<Token>): QuotedString {
        const token = tokens.next();
        // assert type === TokenType.STR
        return new QuotedString(token.raw.slice(1, -1));
    }
}

class Set implements Verb {
    target: VariableExpression;
    expression: Expression;

    constructor(target: VariableExpression, expression: Expression) {
        this.expression = expression;
        this.target = target;
    }

    static parse(tokens: TokenIterator<Token>): Set {
        const var_expression = VariableExpression.parse(tokens);

        expect('after set variable', tokens.next(), TokenType.OP, '=');

        return new Set(var_expression, Expression.parse(tokens));
    }

    eval(joss: Joss): LineLocation | null {
        this.target.eval_set(joss, this.expression.eval(joss));
        return null;
    }
}

class Type implements Verb {
    expressions: StringExpression[];

    constructor(expressions: StringExpression[]) {
        this.expressions = expressions;
    }

    // ? Can't use TokenType here, because then we have to define _all_ token types for the object...
    static parseDecision: Record<number, (tokens: TokenIterator<Token>) => StringExpression> = {
        [TokenType.VAR]: Maths.parse,
        [TokenType.NUM]: Maths.parse,
        [TokenType.OP]: Maths.parse,
        [TokenType.STR]: QuotedString.parse,
        [TokenType.PAREN]: Maths.parse,
    };

    static parse(tokens: TokenIterator<Token>): Type {
        const expressions: StringExpression[] = [];

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

    expect('End of command', tokens.next(), TokenType.PERIOD);
    return command;
}
