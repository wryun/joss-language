export {Joss};
export type {Result, Step};

import { parse } from './parse.ts';
import { tokenise } from './tokenise.ts';


type JossFn = ((...args: any[]) => Result);
type Result = number | boolean | JossFn;

interface Step {
    eval(joss: Joss): void;
}


const FUNCTIONS: Record<string, JossFn> = {
    // Number dissection functions
    sgn: Math.sign,
    ip: Math.trunc,
    fp: (x: number) => x - Math.trunc(x),
    dp: (x: number) => Number(x.toExponential().split('e')[0]),
    xp: (x: number) => Number(x.toExponential().split('e')[1]),

    // Basic functions
    sqrt: Math.sqrt,
    sin: Math.sin,
    cos: Math.cos,
    log: Math.log,
    exp: Math.exp,
    arg: (x: number, y: number) => Math.atan(y / x),

    // Special functions
    sum: (...args: number[]) => args.reduce((acc, n) => acc + n, 0),
    prod: (...args: number[]) => args.reduce((acc, n) => acc * n, 1),
    min: Math.min,
    max: Math.max,
    conj: (...args: boolean[]) => args.reduce((acc, b) => acc && b, true),
    disj: (...args: boolean[]) => args.reduce((acc, b) => acc || b, false),
    tv: (v: boolean|number) => {
        // TODO better way in Typescript?
        switch(typeof(v)) {
            case 'boolean':
                return Number(v);
            case 'number':
                return Boolean(v);
        }
    },
    // TODO: this one is going to need special handling up the stack,
    // as we need to be able to do first(x=1,2,3,4: x > 2) = 3.
    // (i.e. can't just present result of function to first, need input)
    // Or rejig entire argument passing strategy, which seems extreme.
    // first: undefined,
};


class JossArray {
    value: Record<string, Result>;
    dimensions: number;
    sparse: boolean;

    constructor() {
        this.dimensions = 0;
        this.value = {};
        this.sparse = false;
    }

    set(indices: number[], v: Result) {
        if (indices.length !== this.dimensions) {
            this.value = {};
            this.dimensions = indices.length;
        }
        this.value[JossArray.makeKey(indices)] = v;
    }

    static makeKey(indices: Array<number>) {
        // TODO: This feels like the stupidest thing I've ever done, but
        // it sort of works...
        return `(${indices.map(String).join(',')})`;
    }

    get(...indices: number[]) {
        if (indices.length !== this.dimensions) {
            throw new Error('Attempt to index array with incorrect dimensionality');
        }

        const key = JossArray.makeKey(indices);
        if (this.value[key] !== undefined) {
            return this.value[key];
        } else if (this.sparse) {
            return 0;
        } else {
            throw new Error('Missing array contents: ${key}')
        }
    }
}


class Joss {
    stdout: Deno.WriterSync;
    stdin: Deno.Reader;
    arrays: Record<string, JossArray>;
    variables: Record<string, Result>;
    program: Record<string, Step>;
    programParts: Record<string, string[]>;

    constructor(stdin: Deno.Reader, stdout: Deno.WriterSync) {
        this.stdout = stdout;
        this.stdin = stdin;
        this.variables = {};
        this.arrays = {};
        this.program = {};
        this.programParts = {};
    }

    output(s: string) {
        Deno.writeAllSync(this.stdout, new TextEncoder().encode(s));
    }

    setVariable(s: string, v: Result) {
        this.variables[s] = v;
        delete this.arrays[s];
    }

    setArray(s: string, indices: Array<number>, v: Result) {
        (this.arrays[s] ??= new JossArray()).set(indices, v);
        delete this.variables[s];
    }

    setStep(part: string, stepName: string, command: Step) {
        const fullName = `${part}.${stepName}`;
        const previousStep = this.program[fullName];
        this.program[fullName] = command;

        if (!previousStep) {
            // Insert into the ordered array of steps for the part
            // so we can easily iterate over them.
            const stepLoc = Number(fullName);
            let i: number;
            this.programParts[part] ??= [];
            for (i = this.programParts[part].length; i > 0; --i) {
                if (Number(this.programParts[part][i - 1]) < stepLoc) {
                    break;
                }
                this.programParts[part][i] = this.programParts[part][i - 1];
            }
            this.programParts[part][i] = fullName;
        }
    }

    getStep(part: string, stepName: string): Step {
        return this.program[`${part}.${stepName}`];
    }

    *getPartSteps(part: string) {
        for (const fullName of this.programParts[part]) {
            yield this.program[fullName];
        }
    }

    get(s: string): Result {
        if (this.variables[s] !== undefined) {
            return this.variables[s];
        } else if (this.arrays[s]) {
            return this.arrays[s].get.bind(this.arrays[s]);
        } else if (FUNCTIONS[s]) {
            return FUNCTIONS[s];
        } else {
            throw new Error(`No such variable: ${s}`);
        }
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
