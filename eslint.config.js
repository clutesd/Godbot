import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'output/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-properties': [
        'error',
        { 'object': 'Math', 'property': 'random', 'message': 'Use SeededRandom for repeatable behaviour.' }
      ]
    },
  },
  {
    // Everything the browser bundle reaches. Node globals are absent there, so a stray `process`
    // or `require` throws on load and the world never generates, while every node-side test passes.
    files: ['src/sim/**/*.ts', 'src/render/**/*.ts', 'src/shared/**/*.ts', 'src/historian/**/*.ts',
      'src/ui/**/*.ts', 'src/audio/**/*.ts', 'src/main.ts', 'src/config.ts', 'src/presets.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Not available in the browser bundle; thread the value through configuration instead.' },
        { name: 'require', message: 'Not available in the browser bundle; use an ES import.' },
        { name: '__dirname', message: 'Not available in the browser bundle.' },
      ],
    },
  },
);
