export { Expression, VariableExpression, ValueRange };

import { Token, TokenType, TokenIterator } from './tokenise.ts';
import { Joss, Result } from './joss.ts';
import { expect } from './parse_helpers.ts';

interface BinaryOperator {
    prec: number;
    fn: (a: Result, b: Result) => Result;
}

class ConditionalExpression implements Expression {
    conditionResults: {condition: Expression, result: Expression}[] = [];
    result: Expression;
    
    constructor(conditionResults: {condition: Expression, result: Expression}[], result: Expression) {
        this.result = result;
        this.conditionResults = conditionResults;
    }

    eval(joss: Joss, fnArgs: Record<string, Result>): Result {
        for (const {condition, result} of this.conditionResults) {
            if (Boolean(condition.eval(joss, fnArgs))) {
                return result.eval(joss, fnArgs);
            }
        }

        return this.result.eval(joss, fnArgs);
    }
}

abstract class Expression {
    abstract eval(joss: Joss, fnArgs: Record<string, Result>): Result;

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
            case TokenType.OPEN_BRACKET: {
                const conditionResults: {condition: Expression, result: Expression}[] = [];
                tokens.next();
                result = Expression.parse(tokens);
                while (tokens.peek().type === TokenType.COLON) {
                    tokens.next();

                    // i.e. it wasn't a result, it was a condition... confusing.
                    conditionResults.push({condition: result, result: Expression.parse(tokens)});
                    expect('expression for default condition', tokens.next(), TokenType.SEMICOLON);
                    result = Expression.parse(tokens);
                }
                expect('Invalid parenthesis', tokens.next(), TokenType.CLOSE_BRACKET, token.raw === '[' ? ']' : ')');

                if (conditionResults.length > 0) {
                    return new ConditionalExpression(conditionResults, result);
                } else {
                    return result;
                }
            }
            default:
                throw new Error(`Unexpected token in numeric expression: got '${token.raw}'`);
        }
    }

    // TODO error out on conversions (replace with assert);
    // operator precedence.
    static BINARY_OPERATORS: Record<string, BinaryOperator> = {
        'or': {prec: 0, fn: (a, b) => Boolean(a) && Boolean(b)},
        'and': {prec: 1, fn: (a, b) => Boolean(a) && Boolean(b)},
        '=': {prec: 2, fn: (a, b) => a == b},
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

    constructor(v: string, indices: Expression[] = []) {
        this.v = v;
        this.indices = indices;
    }

    eval(joss: Joss, fnArgs: Record<string, Result>): Result {
        const res = fnArgs[this.v] ?? joss.get(this.v);
        if (res instanceof Function && this.indices.length > 0) {
            return res(...this.indices.map(i => i.eval(joss, fnArgs)));
        } else {
            return res;
        }
    }

    eval_set(joss: Joss, value: Result) {
        if (this.indices.length > 0) {
            joss.setArray(this.v, this.indices.map(i => Number(i.eval(joss, {}))), value);
        } else {
            joss.setVariable(this.v, value);
        }
    }

    static parse(tokens: TokenIterator<Token>): VariableExpression {
        const v = tokens.next().raw;
        const indices: Array<Expression> = [];

        let token = tokens.peek();
        if (!(token.type === TokenType.OPEN_BRACKET)) {
            return new VariableExpression(v, indices);
        }

        const expectedBracket = token.raw === '[' ? ']' : ')';

        tokens.next();

        while (true) {
            indices.push(Expression.parse(tokens));

            token = tokens.next();
            if (token.raw === expectedBracket) {
                break;
            }
            expect('variable argument', token, TokenType.COMMA);
        }

        return new VariableExpression(v, indices);
    }
}

class NumberExpression implements Expression {
    num: number;

    constructor(num: number) {
        this.num = num;
    }

    eval(joss: Joss, fnArgs: Record<string, Result>): number {
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

    eval(joss: Joss, fnArgs: Record<string, Result>): Result {
        return this.fn(this.lhs.eval(joss, fnArgs), this.rhs.eval(joss, fnArgs));
    }
}

class ValueRange {
    generators: ((joss: Joss, fnArgs: Record<string, Result>) => Generator<Result>)[];

    constructor() {
        this.generators = [];
    }

    *eval(joss: Joss, fnArgs: Record<string, Result>) {
        for (const g of this.generators) {
            yield* g(joss, fnArgs);
        }
    }

    addSingleValueGenerator(e: Expression) {
        this.generators.push(function *(joss: Joss, fnArgs: Record<string, Result>) {
            yield e.eval(joss, fnArgs);
        });
    }

    addRangeGenerator(start: Expression, step: Expression, end: Expression) {
        this.generators.push(function *(joss: Joss, fnArgs: Record<string, Result>) {
            const endval = Number(end.eval(joss, fnArgs));
            const stepval = Number(step.eval(joss, fnArgs));
            for (let i = Number(start.eval(joss, fnArgs)); i < endval; i += stepval) {
                yield i;
            }
        });
    }

    static parse(tokens: TokenIterator<Token>): ValueRange {
        const vr = new ValueRange();
        let start = Expression.parse(tokens);

        // : ends range expression for function arg,
        // and . when used in for modifier.
        while (![':', '.'].includes(tokens.peek().raw)) {
            const token = tokens.next();
            if (token.raw === ',') {
                vr.addSingleValueGenerator(start);
                start = Expression.parse(tokens);
            } else if (token.type === TokenType.OPEN_BRACKET) {
                const step = Expression.parse(tokens);
                expect('end of step in range', tokens.next(), TokenType.CLOSE_BRACKET, token.raw === '[' ? ']' : ')');
                const end = Expression.parse(tokens);
                vr.addRangeGenerator(start, step, end);
                start = end;
            }
        }

        vr.addSingleValueGenerator(start);
        return vr;
    }
}