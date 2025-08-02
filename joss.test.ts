import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from 'bun:test';

import { Joss } from './joss.ts';


function *get_tests() {
  const testDir = 'tests';
  const files = readdirSync(testDir).filter(f => f.endsWith('.session'));

  for (const fileName of files) {
    const filePath = join(testDir, fileName);
    let expected = '';
    let lineno = 0;
    let command = '';
    let command_lineno = 0;
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      lineno += 1;
      if (line.startsWith('#')) {
        continue;
      }
      if (!line.startsWith('> ')) {
        expected += line + '\n';
        continue;
      }

      if (command !== '') {
        yield {fname: fileName, command_lineno, command, expected};
      }
      command = line.slice(2);
      command_lineno = lineno;
      expected = '';
    }

    yield {fname: fileName, command_lineno, command, expected};
  }
}

class TestOutput {
  private buffer: string = '';

  write(chunk: Uint8Array): void {
    this.buffer += new TextDecoder().decode(chunk);
  }

  getAndClear(): string {
    const result = this.buffer;
    this.buffer = '';
    return result;
  }
}

// Group tests by filename to maintain state within each file
const testsByFile = new Map<string, Array<{command_lineno: number, command: string, expected: string}>>();

for (const {fname, command_lineno, command, expected} of get_tests()) {
  if (!testsByFile.has(fname)) {
    testsByFile.set(fname, []);
  }
  testsByFile.get(fname)!.push({command_lineno, command, expected});
}

// Create tests for each file
for (const [fname, tests] of testsByFile) {
  const joss = new Joss(process.stdin, new TestOutput());

  for (const {command_lineno, command, expected} of tests) {
    test(`${fname}: ${command_lineno}: ${command}`, () => {
      const output = joss.stdout as TestOutput;
      joss.eval(command);
      const actualOutput = output.getAndClear();
      expect(actualOutput).toBe(expected);
    });
  }
}
