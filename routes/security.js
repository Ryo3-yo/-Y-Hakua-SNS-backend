const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Googleの公開鍵取得クライアント設定
const client = jwksClient({
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs'
});

// 公開鍵の取得する関数
function getKey(header, callback) {
  client.getSigningKey(header.kid, function(err, key) {
    if (err) {
      return callback(err, null);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * RISC (Risk Incident Sharing and Coordination) Security Event Receiver
 * Googleからのセキュリティイベントを受信
 */
router.post('/risc', (req, res) => {
    // Content-Typeが application/secevent+jwt の場合もあるから、
    // body-parserの設定によっては req.body が空になる可能性があり。
    // 通常のJSONとして受け取れる場合、tokenは req.body そのものか、req.body.token に入る。
    // GoogleのRISCは通常、Raw BodyそのものがJWTらしい。
    // そのため、express.json() ではなく、テキストとして受け取る必要がある場合があるが、
    // 多くのフレームワークでは req.body に格納される。
    // ここでは req.body が JWT文字列そのもの、または { token: "..." } と仮定して調整。以上AIから要約
    
    const token = req.body.token || req.body; 

    if (!token || typeof token !== 'string') {
        console.error('[RISC] Invalid request format');
        return res.status(400).send('Invalid request');
    }

    const verifyOptions = {
        audience: process.env.GOOGLE_CLIENT_ID, // Google Client ID
        issuer: 'https://accounts.google.com',
        algorithms: ['RS256']
    };

    // 1. JWTの署名検証とクレーム検証 (iss, aud, iat)
    jwt.verify(token, getKey, verifyOptions, (err, decoded) => {
        if (err) {
            console.error('[RISC] Token verification failed:', err.message);
            // 検証失敗時はエラーを返すべきですが、攻撃者に情報を与えないよう
            // ログだけ残して202を返す運用もありますが、ここでは401/400を返します。
            return res.status(400).send('Verification failed');
        }

        console.log('[RISC] Verified Security Event:', decoded);

        // 2. イベント内容に応じた処理 (RISCのイベントタイプを確認)
        // decoded.events の中に具体的なイベント情報が入っています
        const events = decoded.events || {};
        
        if (events['https://schemas.openid.net/secevent/risc/event-type/account-disabled']) {
            // アカウントが無効化された場合の処理 (例: DBのユーザーをロック、全セッション削除)
            handleAccountDisabled(decoded.sub);
        }
        
        if (events['https://schemas.openid.net/secevent/risc/event-type/sessions-revoked']) {
            // セッション取り消しの処理 (例: リフレッシュトークンを無効化)
            handleSessionsRevoked(decoded.sub);
        }

        // 正常に受信・検証できたことをGoogleに通知
        res.status(202).json({ status: 'Accepted' });
    });
});

// 具体的な処理用関数のプレースホルダー
async function handleAccountDisabled(googleUserId) {
    console.log(`[RISC] Disabling account for Google User ID: ${googleUserId}`);
    // ここに MongoDB の更新処理などを記述
    // await User.findOneAndUpdate({ googleId: googleUserId }, { status: 'locked' });
}

async function handleSessionsRevoked(googleUserId) {
    console.log(`[RISC] Revoking sessions for Google User ID: ${googleUserId}`);
    // await User.findOneAndUpdate({ googleId: googleUserId }, { refreshToken: null });
}

module.exports = router;