const router = require('express').Router();
const { google } = require('googleapis');
const User = require('../models/User');
const passport = require('passport');
const { decrypt, encrypt } = require('../utils/crypto');

// Use JWT authentication strategy
router.get('/courses', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    // 1. セッションからユーザー情報を取得
    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      console.log('Refresh token is missing for user:', req.user.id);
      // リフレッシュトークンがない場合は、再ログインを促す
      return res.status(401).json({ message: 'Googleアカウントで再ログインして、アクセスを許可してください。' });
    }

    // 2. GoogleのOAuth2クライアントをセットアップ
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback' // passport.jsのcallbackURLと合わせる
    );

    // 3. ユーザーのDBから取得したトークンをクライアントにセット
    const refreshToken = user.refreshToken ? decrypt(user.refreshToken) : null;
    if (!refreshToken) {
      return res.status(401).json({ message: 'Google認証が必要です。再ログインしてください。' });
    }

    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    // 4. (重要) トークンが更新された場合に備えてイベントリスナーをセット
    // googleapisライブラリが自動でトークンをリフレッシュし、このイベントが発火します
    oauth2Client.on('tokens', async (tokens) => {
      // access tokenはDB保存しない。refresh tokenが来たときだけ再保存。
      if (tokens.refresh_token) {
        await User.findByIdAndUpdate(user.id, { refreshToken: encrypt(tokens.refresh_token) });
      }
    });

    // 5. Classroom APIクライアントを作成
    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });

    // 6. コース一覧を取得
    const apiResponse = await classroom.courses.list({});

    res.json(apiResponse.data.courses || []);

  } catch (error) {
    console.error('Failed to fetch classroom courses:', error.message);
    if (error.response && (error.response.status === 400 || error.response.status === 401)) {
      console.error('Google API Auth Error:', error.response.data);
      return res.status(401).json({ message: 'Googleの認証に失敗しました。アカウント連携を確認し、再ログインしてください。' });
    }
    res.status(500).json({ message: 'コースの取得中にサーバーエラーが発生しました。' });
  }
});

// アナウンスメントを取得する新しいルート
router.get('/announcements', passport.authenticate('jwt', { session: false }), async (req, res) => {
  console.log(`[Classroom] GET /announcements hit for user: ${req.user.id} (${req.user.email})`);
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      return res.status(401).json({ message: 'Google認証が必要です。' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
    );

    const refreshToken = user.refreshToken ? decrypt(user.refreshToken) : null;
    if (!refreshToken) {
      return res.status(401).json({ message: 'Google認証が必要です。再ログインしてください。' });
    }

    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    oauth2Client.on('tokens', async (tokens) => {
      console.log(`[Classroom] Tokens event: tokens received for user ${user._id}`);
      const updates = {};
      // access_tokenはDBに保存しない
      if (tokens.refresh_token) updates.refreshToken = encrypt(tokens.refresh_token);

      if (Object.keys(updates).length > 0) {
        await User.findByIdAndUpdate(user.id, updates);
        console.log(`[Classroom] Tokens updated for user ${user._id}: ${Object.keys(updates).join(', ')}`);
      }
    });

    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });

    // 1. コース一覧を取得
    console.log(`[Classroom] Fetching courses for user ${user._id}`);
    const coursesRes = await classroom.courses.list({
      courseStates: ['ACTIVE']
    });
    const courses = coursesRes.data.courses || [];
    console.log(`[Classroom] Found ${courses.length} active courses`);

    // 2. 各コースのコンテンツを取得（並列処理）
    const contentPromises = courses.map(async (course) => {
      try {
        console.log(`[Classroom] Fetching content for course: ${course.name} (${course.id})`);
        // アナウンスメント、課題、資料を並列で取得
        const [announceRes, courseWorkRes, materialsRes] = await Promise.all([
          classroom.courses.announcements.list({ courseId: course.id, pageSize: 5 }).catch(e => { console.error(`[Classroom] Announce Error (${course.name}):`, e.message); return { data: {} }; }),
          classroom.courses.courseWork.list({ courseId: course.id, pageSize: 5 }).catch(e => { console.error(`[Classroom] CourseWork Error (${course.name}):`, e.message); return { data: {} }; }),
          classroom.courses.courseWorkMaterials.list({ courseId: course.id, pageSize: 5 }).catch(e => { console.error(`[Classroom] Materials Error (${course.name}):`, e.message); return { data: {} }; }),
        ]);

        const announcements = (announceRes.data.announcements || []).map(item => ({
          ...item,
          courseName: course.name,
          courseLink: course.alternateLink,
          type: 'classroom_announcement',
          displayTitle: '[Classroom: アナウンスメント]',
          displayText: item.text,
        }));

        const courseWork = (courseWorkRes.data.courseWork || []).map(item => ({
          ...item,
          courseName: course.name,
          courseLink: course.alternateLink,
          type: 'classroom_coursework',
          displayTitle: '[Classroom: 課題]',
          displayText: `${item.title}${item.description ? '\n\n' + item.description : ''}`,
          materials: item.materials || []
        }));

        const materials = (materialsRes.data.courseWorkMaterial || []).map(item => ({
          ...item,
          courseName: course.name,
          courseLink: course.alternateLink,
          type: 'classroom_material',
          displayTitle: '[Classroom: 資料]',
          displayText: `${item.title}${item.description ? '\n\n' + item.description : ''}`,
          materials: item.materials || []
        }));

        console.log(`[Classroom] Course ${course.name}: ${announcements.length} announcements, ${courseWork.length} coursework, ${materials.length} materials`);
        return [...announcements, ...courseWork, ...materials];
      } catch (err) {
        console.error(`[Classroom] Critical error for course ${course.id}:`, err.message);
        return [];
      }
    });

    const results = await Promise.all(contentPromises);
    const allItems = results.flat();
    console.log(`[Classroom] Total items fetched: ${allItems.length}`);

    // 3. 日付順にソート（新しい順）
    allItems.sort((a, b) => {
      const dateA = new Date(a.updateTime || a.creationTime || a.createdAt);
      const dateB = new Date(b.updateTime || b.creationTime || b.createdAt);
      return dateB - dateA;
    });

    res.json(allItems);

  } catch (error) {
    console.error('Failed to fetch announcements:', error);
    res.status(500).json({ message: 'アナウンスメントの取得に失敗しました。' });
  }
});

module.exports = router;