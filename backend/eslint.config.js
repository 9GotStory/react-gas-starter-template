import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeOnlyGlobals = Object.keys(globals.node)
  .filter((name) => !(name in globals.es2022) && name !== 'console')
  .map((name) => ({
    name,
    message: `Node.js global "${name}" is not available in Google Apps Script V8 runtime.`,
  }));

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.es2022,
        console: 'readonly',
      },
    },
    rules: {
      'no-restricted-globals': ['error', ...nodeOnlyGlobals],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message:
                'Node.js built-in modules are not available in Google Apps Script V8 runtime.',
            },
          ],
        },
      ],
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.test.ts', 'test/**/*.ts', '*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
);
