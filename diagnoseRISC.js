/**
 * RISC API 診断スクリプト
 * サービスアカウントの権限とAPI有効化状態を確認する
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const KEY_FILE = path.join(__dirname, 'hakuaSNScrossaccountKey.json');
const key = JSON.parse(fs.readFileSync(KEY_FILE));

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

async function getTokenForScope(scope) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = b64(header) + '.' + b64(payload);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(key.private_key, 'base64url');

  const postData = querystring.stringify({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: unsigned + '.' + signature,
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

  return JSON.parse(result.body);
}

(async () => {
  console.log('Service account:', key.client_email);
  console.log('Project:', key.project_id);
  console.log();

  // Test 1: RISC scope でトークン取得
  console.log('=== Test 1: RISC scope でトークン取得 ===');
  let riscResult = await getTokenForScope('https://www.googleapis.com/auth/risc.configuration');
  console.log('  access_token:', riscResult.access_token ? 'YES' : 'NO');
  console.log('  id_token:', riscResult.id_token ? 'YES' : 'NO');
  if (riscResult.error) console.log('  error:', riscResult.error, '-', riscResult.error_description);
  console.log();

  // Test 2: cloud-platform scope でトークン取得
  console.log('=== Test 2: cloud-platform scope でトークン取得 ===');
  let cpResult = await getTokenForScope('https://www.googleapis.com/auth/cloud-platform');
  console.log('  access_token:', cpResult.access_token ? 'YES' : 'NO');
  if (cpResult.error) console.log('  error:', cpResult.error, '-', cpResult.error_description);
  console.log();

  // Test 3: cloud-platform の access_token でRISC APIの有効化状態を確認
  if (cpResult.access_token) {
    console.log('=== Test 3: RISC API 有効化状態確認 ===');
    let apiCheck = await httpsRequest({
      hostname: 'serviceusage.googleapis.com',
      path: '/v1/projects/' + key.project_id + '/services/risc.googleapis.com',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + cpResult.access_token },
    });
    try {
      const apiData = JSON.parse(apiCheck.body);
      console.log('  Status code:', apiCheck.status);
      console.log('  State:', apiData.state || 'unknown');
      if (apiData.error) console.log('  Error:', apiData.error.message);
    } catch (e) { console.log('  Response:', apiCheck.body.substring(0, 300)); }
    console.log();

    // Test 4: cloud-platform の access_token で RISC GET stream を試す
    console.log('=== Test 4: cloud-platform token で RISC stream GET ===');
    let streamResult = await httpsRequest({
      hostname: 'risc.googleapis.com',
      path: '/v1beta/stream',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + cpResult.access_token },
    });
    console.log('  Status:', streamResult.status);
    console.log('  Body:', streamResult.body.substring(0, 500));
    console.log();

    // Test 5: cloud-platform token で RISC 登録を試す
    if (streamResult.status !== 404) {
      console.log('=== Test 5: cloud-platform token で RISC 登録テスト ===');
      const data = JSON.stringify({
        delivery: {
          delivery_method: 'https://schemas.openid.net/secevent/risc/delivery-method/push',
          url: 'https://api.yapp.me/api/security/risc',
        },
        events_requested: [
          'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
          'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
          'https://schemas.openid.net/secevent/risc/event-type/tokens-revoked',
        ],
      });
      let regResult = await httpsRequest({
        hostname: 'risc.googleapis.com',
        path: '/v1beta/stream:update',
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + cpResult.access_token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      }, data);
      console.log('  Status:', regResult.status);
      console.log('  Body:', regResult.body.substring(0, 500));
    }
  } else {
    console.log('=== サービスアカウントにIAM権限がありません ===');
    console.log('Google Cloud Console > IAM で以下のロールを追加してください:');
    console.log('  - Service Account Token Creator');
    console.log('  - (または) Owner / Editor');
  }

  // Test: RISC scope token でもAPI呼び出し試行
  if (riscResult.id_token && !riscResult.access_token) {
    console.log();
    console.log('=== 補足: id_token しか取得できていません ===');
    console.log('サービスアカウントに RISC scope のアクセス権がない可能性があります。');
    console.log('Google Cloud Console > IAM > サービスアカウントの権限を確認してください。');
  }
})();
