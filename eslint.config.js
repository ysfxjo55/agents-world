import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'data/**', 'life/**'] },
  js.configs.recommended,
  { files: ['server/**/*.js', 'test/**/*.js', 'bin/**/*.mjs', 'eslint.config.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node } },
  { files: ['public/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser } },
  { rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],                       // "try it, ignore failure" is used on purpose in a few places
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  } },
];
