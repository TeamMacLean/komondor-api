module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.spec.js'],
  testPathIgnorePatterns: ['/node_modules/', '/datastore/', '/files/', '/docs/'],
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/datastore/**',
    '!**/files/**',
    '!**/docs/**',
    '!**/__tests__/**',
    '!jest.config.js',
  ],
  coverageDirectory: 'coverage',
  testTimeout: 10000,
  // Don't transform files - use native Node.js CommonJS support
  transform: {},
};
