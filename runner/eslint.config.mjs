import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.fixture-test-*/**'] },
  ...tseslint.configs.recommended,
);
