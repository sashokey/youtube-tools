import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['**/*.ts'],
  extends: tseslint.configs.recommendedTypeChecked,
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-type-assertion': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    '@typescript-eslint/ban-ts-comment': ['error', {
      'ts-ignore': true,
      'ts-expect-error': true,
      'ts-nocheck': true,
      'ts-check': false,
    }],
  },
});
