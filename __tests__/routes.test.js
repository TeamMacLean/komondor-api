const request = require('supertest');
const app = require('../app');

describe('Basic API Routes', () => {
  describe('GET /test', () => {
    it('should return 200 and a welcome message', async () => {
      const response = await request(app)
        .get('/test')
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Hello there');
    });
  });

  describe('GET /logout', () => {
    it('should return 200', async () => {
      await request(app)
        .get('/logout')
        .expect(200);
    });
  });

  describe('POST /login', () => {
    it('should return 401 when no credentials provided', async () => {
      const response = await request(app)
        .post('/login')
        .send({})
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Bad credentials');
    });

    it('should return 401 when invalid credentials provided', async () => {
      const response = await request(app)
        .post('/login')
        .send({
          username: 'invalid',
          password: 'invalid'
        })
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });
  });
});
