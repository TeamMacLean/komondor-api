// const app = require('../index')
import app from '../app';
import { getUserForToken, sign } from '../lib/utils';
import request from 'supertest';

let userToken;
const fakeUser = {
    fullName: 'Test User',
    username: 'testuser',
    email: 'test@example.org',
    company: 'testers'
};
beforeAll(async () => {

    userToken = await getUserForToken(fakeUser)
        .then(userForToken => {
            return sign(userForToken)
        })

});

describe('Auth Route', () => {

    describe('/me', () => {

        it('should return valid user object from token', async () => {

            const res = await request(app)
                .get('/me')
                .set('Authorization', 'bearer ' + userToken);
            expect(res.statusCode).toEqual(200);
            expect(res.body);
            expect(res.body.user);
            expect(res.body.user).toHaveProperty('name', fakeUser.fullName);
            expect(res.body.user).toHaveProperty('username', fakeUser.username);
            expect(res.body.user).toHaveProperty('email', fakeUser.email);
            expect(res.body.user).toHaveProperty('company', fakeUser.company);

        })
    })
});