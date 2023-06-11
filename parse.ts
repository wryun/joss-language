export {parse};

import { Token, TokenType, TokenIterator } from './tokenise.ts';
import { Joss, Result, Step } from './jossy.ts';

function expect(context: string, t: Token, type: TokenType, raw: (string|null) = null): Token {
    const matches = t.type === type && (raw === null || t.raw === raw);
    if (!matches) {
        throw new Error(`${context}: expected ${type}${raw ? ` "${raw}"` : ''}, got ${JSON.stringify(t)}`);
    }
    return t;
}

class Command implements Step {
    verb: Verb;
    ifmodifier: If|null;

    constructor(verb: Verb, ifmodifier: If|null = null) {
        this.verb = verb;
        this.ifmodifier = ifmodifier;
    }

    eval(joss: Joss): void {
        if (!this.ifmodifier || this.ifmodifier.eval(joss)) {
            this.verb.eval(joss);
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
            case 'Do':
                verb = Do.parse(tokens);
                break;
            default:
                throw new Error(`${token.raw} is not a command`);
            }
            break;
        default:
            throw new Error(`Expecting verb to start command, got ${token.raw}`);
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
        expect('', tokens.next(), TokenType.ID, 'if');

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
    abstract eval(joss: Joss): void;
}

class NoOp implements Verb {
    eval(_joss: Joss): void {}
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
        } else {
            joss.setVariable(this.v, value);
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

    eval(joss: Joss): void {
        this.target.eval_set(joss, this.expression.eval(joss));
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

    eval(joss: Joss): void {
        for (const e of this.expressions) {
            joss.output(e.eval(joss));
            joss.output('\n');
        }
    }
}

class ValueRange {
    generators: ((joss: Joss) => Generator<Result>)[];

    constructor() {
        this.generators = [];
    }

    *eval(joss: Joss) {
        for (const g of this.generators) {
            yield* g(joss);
        }
    }

    addSingleValueGenerator(e: Expression) {
        this.generators.push(function *(joss: Joss) {
            yield e.eval(joss);
        });
    }

    addRangeGenerator(start: Expression, step: Expression, end: Expression) {
        this.generators.push(function *(joss: Joss) {
            const endval = Number(end.eval(joss));
            const stepval = Number(step.eval(joss));
            for (let i = Number(start.eval(joss)); i < endval; i += stepval) {
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
            } else if (token.raw === '(') {
                const step = Expression.parse(tokens);
                expect('end of step in range', tokens.next(), TokenType.PAREN, ')');
                const end = Expression.parse(tokens);
                vr.addRangeGenerator(start, step, end);
                start = end;
            }
        }

        vr.addSingleValueGenerator(start);
        return vr;
    }
}

class Do implements Verb {
    part: string;
    step: string | null;
    times: Expression | null;
    for: {s: string, range: ValueRange} | null;

    constructor(part: string, step: string | null = null) {
        this.part = part;
        this.step = step;
        this.times = null;
        this.for = null;
    }

    // i.e. eval without modifier.
    evalDo(joss: Joss): void {
        if (this.step) {
            joss.getStep(this.part, this.step).eval(joss);
        } else {
            for (const step of joss.getPartSteps(this.part)) {
                step.eval(joss);
            }
        }
    }

    eval(joss: Joss): void {
        if (this.times) {
            for (let i = 0; i < Number(this.times.eval(joss)); ++i) {
                this.evalDo(joss);
            }
        } else if (this.for) {
            for (const v of this.for.range.eval(joss)) {
                joss.setVariable(this.for.s, v);
                this.evalDo(joss);
            }
        } else {
            this.evalDo(joss);
        }
    }

    static parse(tokens: TokenIterator<Token>): Do {
        let token = tokens.next();
        switch (token.raw) {
            case 'step':
                token = tokens.next();
                if (!token.raw.includes('.')) {
                    throw new Error('Invalid step (i.e. must be 1.1, not 1)');
                }
                break;
            case 'part':
                token = tokens.next();
                if (token.raw.includes('.')) {
                    throw new Error('Invalid part (i.e. must be 1, not 1.1)');
                }
                break;
            default:
                throw new Error('Expecting step or part after Do');
        }

        const [part, step] = token.raw.split('.');
        const doVerb = new Do(part, step || null);

        // Add possible modifier.
        switch  (tokens.peek().raw) {
            case 'for':
                tokens.next();
                token = expect('variable for range', tokens.next(), TokenType.VAR);
                expect('= for range', tokens.next(), TokenType.OP, '=');
                doVerb.for = {s: token.raw, range: ValueRange.parse(tokens)};
                break;
            case ',':
                tokens.next();
                doVerb.times = Expression.parse(tokens);
                expect('expecting times after expression following for', tokens.next(), TokenType.ID, 'times');
                break;
            default:
                break;
        }

        return doVerb;
    }
}

class StoredCommand {
    part: string;
    step: string;
    command: Command;

    constructor(part: string, step: string, command: Command) {
        this.part = part;
        this.step = step;
        this.command = command;
    }

    eval(joss: Joss): void {
        joss.setStep(this.part, this.step, this.command);
    }

    static parse(tokens: TokenIterator<Token>): StoredCommand {
        const token = tokens.next();
        if (!token.raw.includes('.')) {
            throw new Error('Line number without step (i.e. must be 1.1, not 1)');
        }
        const [part, step] = token.raw.split('.');
        return new StoredCommand(part, step, Command.parse(tokens));
    }
}

function parse(tokens: TokenIterator<Token>): Command|StoredCommand {
    if (tokens.peek().type === TokenType.NUM) {
        const sc = StoredCommand.parse(tokens);
        expect('End of command', tokens.next(), TokenType.PERIOD);
        return sc;
    } else {
        const command = Command.parse(tokens);
        expect('End of command', tokens.next(), TokenType.PERIOD);
        return command;
    }
}
