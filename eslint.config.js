import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    ignores: ['dist/**', 'node_modules/**', '.cache/**', 'coverage/**']
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Security rules
      'no-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-implied-eval': 'error',

      // TypeScript strict rules
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/strict-boolean-expressions': ['error', {
        allowString: false,
        allowNumber: false,
        allowNullableObject: false,
        allowNullableBoolean: false,
        allowNullableString: false,
        allowNullableNumber: false,
        allowNullableEnum: false,
        allowAny: false
      }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports'
      }],
      '@typescript-eslint/consistent-type-exports': ['error', {
        fixMixedExportsWithInlineTypeSpecifier: true
      }],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-useless-empty-export': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/method-signature-style': ['error', 'property'],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        { selector: 'property', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'import', format: null },
        // Allow snake_case for API response types (external API format)
        { selector: 'typeProperty', format: ['camelCase', 'snake_case', 'UPPER_CASE', 'PascalCase'] }
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowNumber: true,
        allowBoolean: false,
        allowAny: false,
        allowNullish: false
      }],
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-find': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/class-methods-use-this': ['error', {
        ignoreOverrideMethods: true,
        ignoreClassesThatImplementAnInterface: true
      }],

      // General rules
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-throw-literal': 'off', // handled by @typescript-eslint/only-throw-error
      'prefer-promise-reject-errors': 'error',
      'no-return-await': 'off', // handled by @typescript-eslint/return-await

      // Complexity rules
      'complexity': ['warn', { max: 20 }],
      'max-depth': ['error', { max: 4 }],
      'max-nested-callbacks': ['error', { max: 3 }],
      'max-params': ['error', { max: 5 }],
      'no-param-reassign': ['error', { props: false }],
      'no-else-return': ['error', { allowElseIf: false }],
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'prefer-object-spread': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'prefer-destructuring': ['error', {
        VariableDeclarator: { array: false, object: true },
        AssignmentExpression: { array: false, object: false }
      }, {
        enforceForRenamedProperties: false
      }],
      'no-useless-concat': 'error',
      'no-useless-rename': 'error',
      'no-useless-return': 'error',
      'require-atomic-updates': 'off', // produces false positives for rate limiting patterns

      // Code style
      'no-multiple-empty-lines': ['error', { max: 1 }],
      'no-trailing-spaces': 'error',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }]
    }
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Relaxed rules for tests
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/class-methods-use-this': 'off',
      'no-console': 'off',
      'complexity': 'off',
      'max-depth': 'off',
      'max-nested-callbacks': 'off',
      'max-params': 'off'
    }
  }
);
