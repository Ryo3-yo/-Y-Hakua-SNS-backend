const { createClient } = require('redis');
const dotenv = require('dotenv');

dotenv.config();

const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => console.log('Redis Client Error', err));

async function connectRedis() {
    if (!client.isOpen) {
        await client.connect();
        console.log('Connected to Redis');
    }
}

connectRedis();

module.exports = client;
