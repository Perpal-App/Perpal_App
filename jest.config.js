/**
 * Tests live in one tree at `tests/`, mirroring `src/`. See AGENTS.md.
 * `jest-expo` supplies the React Native transform and module resolution.
 */
const expoPreset = require('jest-expo/jest-preset');

// `@noble` and `@scure` ship ESM only and back wallet derivation, so they must be
// transformed rather than ignored. Extend jest-expo's own list instead of
// replacing it: the preset needs its entries for expo-modules-core and friends.
const ESM_SCOPES = ['@noble', '@scure'];

const transformIgnorePatterns = (
  expoPreset.transformIgnorePatterns ?? ['node_modules/']
).map((pattern) =>
  pattern.includes('node_modules/(?!')
    ? pattern.replace('node_modules/(?!', `node_modules/(?!${ESM_SCOPES.join('|')}|`)
    : pattern,
);

module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns,
  clearMocks: true,
  restoreMocks: true,
};
