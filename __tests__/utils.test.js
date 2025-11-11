const toSafeName = require('../lib/utils/toSafeName');

describe('Utility Functions', () => {
  describe('toSafeName', () => {
    it('should convert string to lowercase', () => {
      expect(toSafeName('UPPERCASE')).toBe('uppercase');
    });

    it('should replace ampersands with "and"', () => {
      expect(toSafeName('Tom & Jerry')).toBe('tom_and_jerry');
    });

    it('should replace special characters with underscores', () => {
      expect(toSafeName('hello@world!')).toBe('hello_world_');
    });

    it('should replace spaces with underscores', () => {
      expect(toSafeName('hello world')).toBe('hello_world');
    });

    it('should handle mixed cases correctly', () => {
      expect(toSafeName('Project-Name & Test 123!')).toBe('project_name_and_test_123_');
    });

    it('should keep alphanumeric characters', () => {
      expect(toSafeName('abc123')).toBe('abc123');
    });

    it('should handle empty string', () => {
      expect(toSafeName('')).toBe('');
    });
  });
});
