export {parse};

import { Token, TokenType, TokenIterator } from './tokenise.ts';
import { Joss, Step } from './joss.ts';
import { expect } from './parse_helpers.ts';
import { Expression, VariableExpression, ValueRange } from './expression.ts';

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
            case 'Let':
                verb = Let.parse(tokens);
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
        return Boolean(this.expression.eval(joss, {}));
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

class Maths implements StringExpression {
    expression: Expression;

    constructor(expr: Expression) {
        this.expression = expr;
    }

    eval(joss: Joss): string {
        return this.expression.eval(joss, {}).toString();
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

    eval(_joss: Joss): string {
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
        this.target.eval_set(joss, this.expression.eval(joss, {}));
    }
}

class Let implements Verb {
    target: VariableExpression;
    argNames: string[];
    expression: Expression;

    constructor(target: VariableExpression, argNames: string[], expression: Expression) {
        this.expression = expression;
        this.target = target;
        this.argNames = argNames;
    }

    eval(joss: Joss): void {
        this.target.eval_set(joss, (...args: any[]) => {
            if (args.length !== this.argNames.length) {
                throw new Error('Invalid arity on function call');
            }
            const fnArgs = args.reduce((o, arg, i) => {
                o[this.argNames[i]] = arg;
                return o;
            }, {});

            return this.expression.eval(joss, fnArgs);
        });
    }

    static parse(tokens: TokenIterator<Token>): Set {
        const v = tokens.next().raw;

        let token = tokens.peek();
        const argNames: string[] = [];
        if (token.type === TokenType.OPEN_BRACKET) {
            tokens.next();
            const expectedBracket = token.raw === '[' ? ']' : ')';

            while (true) {
                token = expect('variable name', tokens.next(), TokenType.VAR);
                argNames.push(token.raw);
                if (tokens.peek().type === TokenType.CLOSE_BRACKET) {
                    break;
                }
                expect('next variable argument', token, TokenType.COMMA);
            }
            expect('end of function arguments', tokens.next(), TokenType.CLOSE_BRACKET, expectedBracket);
        }

        expect('after set variable', tokens.next(), TokenType.OP, '=');

        return new Let(new VariableExpression(v), argNames, Expression.parse(tokens));
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
        [TokenType.OPEN_BRACKET]: Maths.parse,
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
            for (let i = 0; i < Number(this.times.eval(joss, {})); ++i) {
                this.evalDo(joss);
            }
        } else if (this.for) {
            for (const v of this.for.range.eval(joss, {})) {
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
        switch (tokens.peek().raw) {
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
