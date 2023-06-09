export {parse};

import { Token, TokenType, TokenIterator } from './tokenise.ts';
import { Joss } from './jossy.ts';

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
            case 'Set':
                return Set.parse(tokens);
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

    static parse(tokens: TokenIterator<Token>): NumericExpression {
        return this.parse_binary(tokens, this.parse_unary(tokens));
    }

    static parse_unary(tokens: TokenIterator<Token>): NumericExpression {
        const token = tokens.next();
        switch (token.type) {
            case TokenType.NUM:
                return new NumberExpression(Number(token.raw));
            case TokenType.VAR:
                return new VariableExpression(token.raw);
            default:
                throw new Error(`Only number supported - got '${token.raw}'`);
        }
    }

    static BINARY_OPERATORS: Record<string, BinaryOperator> = {
        '+': {prec: 1, fn: (a, b) => a + b},
        '-': {prec: 1, fn: (a, b) => a - b},
        '/': {prec: 2, fn: (a, b) => a / b},
        '*': {prec: 2, fn: (a, b) => a * b},
    }

    static parse_binary(tokens: TokenIterator<Token>, lhs: NumericExpression, min_prec = 0): NumericExpression {
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

class VariableExpression implements NumericExpression {
    v: string;

    constructor(v: string) {
        this.v = v;
    }

    eval(joss: Joss): number {
        return joss.get(this.v);
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

class Set implements Command {
    target: string;
    expression: NumericExpression;

    constructor(target: string, expression: NumericExpression) {
        this.expression = expression;
        this.target = target;
    }

    static parse(tokens: TokenIterator<Token>): Set {
        let token = tokens.next();
        if (token.type !== TokenType.VAR) {
            throw new Error(`Set must be followed by variable name; got ${token.type}: ${token.raw}`);
        }
        const target = token.raw;

        token = tokens.next();
        if (token.type !== TokenType.OP && token.raw !== '=') {
            throw new Error(`Set must have = after variable; got ${token.raw}`);
        }

        return new Set(target, NumericExpression.parse(tokens));
    }

    eval(joss: Joss): LineLocation | null {
        joss.set(this.target, this.expression.eval(joss));
        return null;
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
