/**
 * RISC レシーバー登録スクリプト（一度だけ実行）
 * Google Cross-Account Protection のエンドポイントを登録する
 *
 * 使い方: node registerRISC.js
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const RISC_RECEIVER_URL = 'https://api.yapp.me/api/security/risc';
const KEY_FILE = path.join(__dirname, 'hakuaSNScrossaccountKey.json');

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * サービスアカウントの秘密鍵でJWTを自前で作成し、
 * Google OAuth2 トークンエンドポイントから access_token を取得する
 */
async function getToken() {
  const key = JSON.parse(fs.readFileSync(KEY_FILE));

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/risc.configuration',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = b64(header) + '.' + b64(payload);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(key.private_key, 'base64url');
  const assertion = unsigned + '.' + signature;

  const postData = querystring.stringify({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: assertion,
  });

  const result = await httpsRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  }, postData);

  const tokenData = JSON.parse(result.body);
  if (tokenData.error) {
    throw new Error('Token error: ' + tokenData.error + ' - ' + (tokenData.error_description || ''));
  }
  if (!tokenData.access_token) {
    throw new Error('No access_token in response: ' + result.body);
  }
  console.log('Access token obtained successfully');
  return tokenData.access_token;
}

async function registerRISC() {
  const token = await getToken();

  const data = JSON.stringify({
    delivery: {
      delivery_method: 'https://schemas.openid.net/secevent/risc/delivery-method/push',
      url: RISC_RECEIVER_URL,
    },
    events_requested: [
      'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
      'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
      'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
      'https://schemas.openid.net/secevent/risc/event-type/tokens-revoked',
      'https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required',
    ],
  });

  const result = await httpsRequest({
    hostname: 'risc.googleapis.com',
    path: '/v1beta/stream:update',
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  }, data);

  console.log('Registration Status:', result.status);
  if (result.body) {
    try { console.log(JSON.stringify(JSON.parse(result.body), null, 2)); } catch (e) { console.log(result.body); }
  } else {
    console.log('(empty response - success)');
  }

  if (result.status < 200 || result.status >= 300) {
    throw new Error('Registration failed with HTTP ' + result.status);
  }
}

async function verifyRegistration() {
  const token = await getToken();

  const result = await httpsRequest({
    hostname: 'risc.googleapis.com',
    path: '/v1beta/stream',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });

  console.log('\n--- Current RISC Configuration ---');
  console.log('Status:', result.status);
  try { console.log(JSON.stringify(JSON.parse(result.body), null, 2)); } catch (e) { console.log(result.body); }
}

(async () => {
  try {
    console.log('Registering RISC receiver:', RISC_RECEIVER_URL);
    await registerRISC();
    console.log('\nRISC registration successful!');

    console.log('\nVerifying registration...');
    await verifyRegistration();
  } catch (err) {
    console.error('RISC registration failed:', err.message);
    process.exit(1);
  }
})();
