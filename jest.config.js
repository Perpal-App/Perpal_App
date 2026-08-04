/**
 * Tests live in one tree at `tests/`, mirroring `src/`. See AGENTS.md.
 * `jest-expo` supplies the React Native transform and module resolution.
 */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  clearMocks: true,
  restoreMocks: true,
};
