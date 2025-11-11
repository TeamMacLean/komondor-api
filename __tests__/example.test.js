const request = require('supertest');

describe('Example Test Suite', () => {
  test('basic arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });

  test('strings concatenate correctly', () => {
    expect('hello' + ' ' + 'world').toBe('hello world');
  });

  test('arrays have correct length', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
  });
});

describe('Math operations', () => {
  test('multiplication works', () => {
    expect(2 * 3).toBe(6);
  });

  test('arrays can be filtered', () => {
    const numbers = [1, 2, 3, 4, 5];
    const evens = numbers.filter(n => n % 2 === 0);
    expect(evens).toEqual([2, 4]);
  });
});
