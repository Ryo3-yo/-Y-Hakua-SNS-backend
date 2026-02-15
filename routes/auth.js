const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const User = require("../models/User");

// ログイン・登録用レート制限
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 20, // 15分間に最大20回
  message: { error: 'リクエストが多すぎます。しばらくしてからお試しください。' },
  standardHeaders: true,
  legacyHeaders: false,
});

// JWT秘密鍵チェック（起動時に環境変数が設定されていなければ警告）
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set');
}
const JWT_ISSUER = process.env.JWT_ISSUER || 'hakua-sns';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'hakua-clients';

//ユーザー登録
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // 入力バリデーション
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'ユーザー名、メールアドレス、パスワードは必須です' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
    }
    if (username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: 'ユーザー名は2〜30文字にしてください' });
    }

    // パスワードをハッシュ化
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });
    const user = await newUser.save();
    const { password: _, ...userWithoutPassword } = user._doc;
    return res.status(200).json(userWithoutPassword);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'そのユーザー名またはメールアドレスは既に使用されています' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: '登録に失敗しました' });
  }
});

//ログイン
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'メールアドレスとパスワードは必須です' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "ユーザーが見つかりません" });

    // パスワードがない（Google認証ユーザー）
    if (!user.password) {
      return res.status(400).json({ error: 'このアカウントはGoogleログインを使用してください' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "パスワードが違います" });

    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      {
        expiresIn: '7d',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );

    const { password: _, accessToken: _a, refreshToken: _r, ...userWithoutSensitive } = user._doc;
    return res.status(200).json({ ...userWithoutSensitive, token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'ログインに失敗しました' });
  }
});


// Google OAuth ログイン
router.get(
  '/google',
  (req, res, next) => {
    if (req.query.platform === 'mobile') {
      // セッションとCookieの両方に保存（冗長性確保）
      req.session.oauthPlatform = 'mobile';
      res.cookie('oauth_platform', 'mobile', {
        maxAge: 5 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
      });
    }
    next();
  },
  passport.authenticate('google', {
    scope: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.announcements.readonly',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly'
    ],
    accessType: 'offline',
    prompt: 'consent',
    includeGrantedScopes: true
  })
);

// Google OAuth コールバック
router.get(
  '/google/callback',
  // ★ Passportがセッションを再生成する前にplatformを読み取る
  (req, res, next) => {
    // セッションから読み取り（Passport処理前なのでまだ存在する）
    req._oauthPlatform = req.session?.oauthPlatform || null;
    // セッションが失われていた場合はCookieから読み取り
    if (!req._oauthPlatform) {
      const cookies = req.headers.cookie || '';
      const match = cookies.match(/oauth_platform=([^;]+)/);
      if (match) req._oauthPlatform = match[1];
    }
    console.log('[OAuth Callback] Platform detected:', req._oauthPlatform);
    next();
  },
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL || ''}/login` }),
  (req, res) => {
    // ログストリーム用: 誰がGoogleログインしたかを記録（トークンは出さない）
    console.log('[Auth] Google login success', {
      userId: req.user?._id?.toString(),
      email: req.user?.email,
      username: req.user?.username,
      platform: req._oauthPlatform || 'web',
      at: new Date().toISOString(),
    });

    // JWTトークンを生成
    const token = jwt.sign(
      { id: req.user._id, email: req.user.email },
      JWT_SECRET,
      {
        expiresIn: '7d',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );

    // Web: HttpOnly Cookieで返す
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    if (req._oauthPlatform === 'mobile') {
      res.clearCookie('oauth_platform');
      const deepLink = `hakuasns://auth/success#token=${token}`;
      return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ログイン完了</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:-apple-system,sans-serif;margin:0;background:#f0f2f5;">
  <p style="font-size:18px;color:#333;margin-bottom:20px;">ログインが完了しました</p>
  <a id="openApp" href="${deepLink}" style="display:inline-block;padding:16px 40px;background:#1775ee;color:white;border-radius:30px;text-decoration:none;font-size:16px;font-weight:600;">アプリを開く</a>
  <p style="font-size:14px;color:#666;margin-top:20px;">ボタンが動作しない場合は、手動でアプリに戻ってください</p>
  <script>
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = '${deepLink}';
    document.body.appendChild(iframe);
    setTimeout(function() {
      window.location.replace('${deepLink}');
    }, 500);
  </script>
</body></html>`);
    }

    res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
  }
);

// ログアウト
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

module.exports = router;
