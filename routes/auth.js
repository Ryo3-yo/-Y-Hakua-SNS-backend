const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require("../models/User");

//ユーザー登録
router.post("/register", async (req, res) => {
  try {
    const newUser = new User({
      username: req.body.username,
      email: req.body.email,
      password: req.body.password,
    });
    const user = await newUser.save();
    return res.status(200).json(user);
  } catch (err) {
    return res.status(500).json(err);
  }
});

//ログイン
router.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).send("ユーザーが見つかりません");

    const vaildPassword = req.body.password === user.password;
    if (!vaildPassword) return res.status(400).json("パスワードが違います");

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );

    const { password, ...userWithoutPassword } = user._doc;
    return res.status(200).json({ ...userWithoutPassword, token });
  } catch (err) {
    return res.status(500).json(err);
  }
});


// Google OAuth ログイン
router.get(
  '/google',
  (req, res, next) => {
    // platformパラメータをセッションに保存（コールバック時に参照）
    if (req.query.platform) {
      req.session.oauthPlatform = req.query.platform;
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
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL || ''}/login` }),
  (req, res) => {
    // JWTトークンを生成
    const token = jwt.sign(
      { id: req.user._id, email: req.user.email },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );

    // モバイルアプリからのリクエストの場合、カスタムURLスキームにリダイレクト
    const platform = req.query.state || req.session?.oauthPlatform;
    if (platform === 'mobile') {
      return res.redirect(`hakuasns://auth/success?token=${token}`);
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
