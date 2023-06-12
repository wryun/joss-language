export {expect};

import { Token, TokenType } from './tokenise.ts';

function expect(context: string, t: Token, type: TokenType, raw: (string|null) = null): Token {
    const matches = t.type === type && (raw === null || t.raw === raw);
    if (!matches) {
        throw new Error(`${context}: expected ${type}${raw ? ` "${raw}"` : ''}, got ${JSON.stringify(t)}`);
    }
    return t;
}