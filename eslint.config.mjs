import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', '.vscode/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['lib/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
      'no-plusplus': 'off',
      'no-bitwise': 'off',
      'no-param-reassign': 'off',
      'no-unused-vars': 'off',
      'no-underscore-dangle': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
