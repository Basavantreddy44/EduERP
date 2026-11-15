/** Integration tests run against the real Postgres test database (eduerp_test) with RLS active. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/env.ts'],
  testTimeout: 30000,
};
