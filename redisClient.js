const dotenv = require("dotenv");
const { Redis } = require("@upstash/redis");

dotenv.config();

// Upstash Redis (REST)
// Render/Vercel等では環境変数で設定:
// - UPSTASH_REDIS_REST_URL
// - UPSTASH_REDIS_REST_TOKEN
//
// 互換性のため、既存コードは `redisClient.xxx(...)` をこのインスタンスに対して呼び出す前提。
const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = redisClient;
