import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'dist-renderer/**',
      'coverage/**',
      'node_modules/**',
      '.cache/**',
      '.tools/**',
      'test-results/**',
      'playwright-report/**',
      'src/render/palette.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'svelte/no-at-html-tags': 'off',
      'svelte/require-each-key': 'off',
      'svelte/prefer-svelte-reactivity': 'off',
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] } },
  },
  {
    // The deterministic core must never use Math.random or touch the DOM.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG (core/rng.ts).' },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'performance'],
    },
  },
);
