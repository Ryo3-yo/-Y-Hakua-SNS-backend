const router = require('express').Router();
const LearningSession = require('../models/LearningSession');
const LearningGoal = require('../models/LearningGoal');
const User = require('../models/User'); // Userモデルも必要になるため追加
const { Redis } = require('@upstash/redis');

// Redisクライアントの初期化
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Redisキーの生成ヘルパー
const getWeeklyRankingKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    // ISO週番号の計算（簡易版）
    const start = new Date(year, 0, 1);
    const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
    const week = Math.ceil((days + 1) / 7);
    return `learning:ranking:weekly:${year}:${week}`;
};

// =====================================
// 学習セッション関連のエンドポイント
// =====================================

// 学習セッション開始
router.post('/sessions/start', async (req, res) => {
    try {
        const { userId, subject } = req.body;

        // 既にアクティブなセッションがあるかチェック
        const existingSession = await LearningSession.findOne({
            userId,
            isActive: true,
        });

        if (existingSession) {
            return res.status(400).json({
                message: '既にアクティブな学習セッションがあります',
                session: existingSession,
            });
        }

        const newSession = new LearningSession({
            userId,
            subject: subject || '',
            startTime: new Date(),
            isActive: true,
        });

        const savedSession = await newSession.save();
        res.status(201).json(savedSession);
    } catch (err) {
        console.error('Error starting learning session:', err);
        res.status(500).json({ message: 'セッション開始に失敗しました' });
    }
});

// 学習セッション終了
router.post('/sessions/stop', async (req, res) => {
    try {
        const { userId } = req.body;

        const session = await LearningSession.findOne({
            userId,
            isActive: true,
        });

        if (!session) {
            return res.status(404).json({ message: 'アクティブなセッションがありません' });
        }

        const endTime = new Date();
        const duration = Math.round((endTime - session.startTime) / 1000 / 60); // 分に変換

        session.endTime = endTime;
        session.duration = duration;
        session.isActive = false;

        const updatedSession = await session.save();

        // Redisの週間ランキングを更新
        try {
            const rankingKey = getWeeklyRankingKey();
            await redis.zincrby(rankingKey, duration, userId);
        } catch (redisErr) {
            console.error('Redis ranking update failed:', redisErr);
            // Redis更新失敗はクリティカルではないため、処理は続行
        }

        res.status(200).json(updatedSession);
    } catch (err) {
        console.error('Error stopping learning session:', err);
        res.status(500).json({ message: 'セッション終了に失敗しました' });
    }
});

// アクティブなセッションを取得
router.get('/sessions/active/:userId', async (req, res) => {
    try {
        const session = await LearningSession.findOne({
            userId: req.params.userId,
            isActive: true,
        });

        res.status(200).json(session);
    } catch (err) {
        console.error('Error fetching active session:', err);
        res.status(500).json({ message: 'セッション取得に失敗しました' });
    }
});

// セッション一覧取得（日付範囲指定可能）
router.get('/sessions/:userId', async (req, res) => {
    try {
        const { startDate, endDate, limit } = req.query;
        const query = { userId: req.params.userId, isActive: false };

        if (startDate || endDate) {
            query.startTime = {};
            if (startDate) query.startTime.$gte = new Date(startDate);
            if (endDate) query.startTime.$lte = new Date(endDate);
        }

        const sessions = await LearningSession.find(query)
            .sort({ startTime: -1 })
            .limit(parseInt(limit) || 50);

        res.status(200).json(sessions);
    } catch (err) {
        console.error('Error fetching sessions:', err);
        res.status(500).json({ message: 'セッション一覧取得に失敗しました' });
    }
});

// =====================================
// 統計関連のエンドポイント
// =====================================

// 統計データを取得
router.get('/stats/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const now = new Date();

        // 今日の開始時刻
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        // 今週の開始時刻（日曜日）
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);

        // 今月の開始時刻
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // 各期間の学習時間を集計
        const [todayStats, weekStats, monthStats, totalStats] = await Promise.all([
            LearningSession.aggregate([
                {
                    $match: {
                        userId: require('mongoose').Types.ObjectId.createFromHexString(userId),
                        startTime: { $gte: todayStart },
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
            LearningSession.aggregate([
                {
                    $match: {
                        userId: require('mongoose').Types.ObjectId.createFromHexString(userId),
                        startTime: { $gte: weekStart },
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
            LearningSession.aggregate([
                {
                    $match: {
                        userId: require('mongoose').Types.ObjectId.createFromHexString(userId),
                        startTime: { $gte: monthStart },
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
            LearningSession.aggregate([
                {
                    $match: {
                        userId: require('mongoose').Types.ObjectId.createFromHexString(userId),
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
        ]);

        // 日別の統計（過去7日間）
        const dailyStats = await LearningSession.aggregate([
            {
                $match: {
                    userId: require('mongoose').Types.ObjectId.createFromHexString(userId),
                    startTime: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
                    isActive: false,
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
                    totalMinutes: { $sum: '$duration' },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        res.status(200).json({
            today: todayStats[0]?.totalMinutes || 0,
            week: weekStats[0]?.totalMinutes || 0,
            month: monthStats[0]?.totalMinutes || 0,
            total: totalStats[0]?.totalMinutes || 0,
            dailyStats,
        });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ message: '統計データ取得に失敗しました' });
    }
});

// =====================================
// ストリーク関連のエンドポイント
// =====================================

// ストリーク情報を取得
router.get('/streak/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        // 過去100日間の学習日を取得
        const learningDays = await LearningSession.aggregate([
            {
                $match: {
                    userId: require('mongoose').Types.ObjectId.createFromHexString(userId),
                    isActive: false,
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
                },
            },
            { $sort: { _id: -1 } },
            { $limit: 100 },
        ]);

        const dates = learningDays.map((d) => d._id).sort().reverse();

        // 現在のストリークを計算
        let currentStreak = 0;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];

        // 今日か昨日のデータがあればストリーク計算開始
        if (dates.length > 0 && (dates[0] === today || dates[0] === yesterday)) {
            currentStreak = 1;
            for (let i = 1; i < dates.length; i++) {
                const prevDate = new Date(dates[i - 1]);
                const currDate = new Date(dates[i]);
                const diffDays = Math.round(
                    (prevDate - currDate) / (1000 * 60 * 60 * 24)
                );

                if (diffDays === 1) {
                    currentStreak++;
                } else {
                    break;
                }
            }
        }

        // 最長ストリークを計算
        let longestStreak = 0;
        let tempStreak = 1;
        const sortedDates = [...dates].sort();

        for (let i = 1; i < sortedDates.length; i++) {
            const prevDate = new Date(sortedDates[i - 1]);
            const currDate = new Date(sortedDates[i]);
            const diffDays = Math.round(
                (currDate - prevDate) / (1000 * 60 * 60 * 24)
            );

            if (diffDays === 1) {
                tempStreak++;
            } else {
                longestStreak = Math.max(longestStreak, tempStreak);
                tempStreak = 1;
            }
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        if (dates.length === 0) {
            longestStreak = 0;
        }

        res.status(200).json({
            currentStreak,
            longestStreak,
            learningDates: dates.slice(0, 30), // 過去30日分の学習日
        });
    } catch (err) {
        console.error('Error fetching streak:', err);
        res.status(500).json({ message: 'ストリーク情報取得に失敗しました' });
    }
});

// =====================================
// 目標関連のエンドポイント
// =====================================

// 目標を取得
router.get('/goals/:userId', async (req, res) => {
    try {
        const goals = await LearningGoal.find({
            userId: req.params.userId,
            isActive: true,
        });

        res.status(200).json(goals);
    } catch (err) {
        console.error('Error fetching goals:', err);
        res.status(500).json({ message: '目標取得に失敗しました' });
    }
});

// 目標を設定/更新
router.post('/goals', async (req, res) => {
    try {
        const { userId, type, targetMinutes } = req.body;

        // 既存の目標があれば更新、なければ作成
        const goal = await LearningGoal.findOneAndUpdate(
            { userId, type },
            { userId, type, targetMinutes, isActive: true },
            { upsert: true, new: true }
        );

        res.status(200).json(goal);
    } catch (err) {
        console.error('Error setting goal:', err);
        res.status(500).json({ message: '目標設定に失敗しました' });
    }
});

// 目標を削除
router.delete('/goals/:id', async (req, res) => {
    try {
        await LearningGoal.findByIdAndUpdate(req.params.id, { isActive: false });
        res.status(200).json({ message: '目標を削除しました' });
    } catch (err) {
        console.error('Error deleting goal:', err);
        res.status(500).json({ message: '目標削除に失敗しました' });
    }
});

// =====================================
// ランキング関連のエンドポイント
// =====================================

// 週間学習時間ランキングを取得
router.get('/ranking/weekly', async (req, res) => {
    try {
        const rankingKey = getWeeklyRankingKey();

        // 1. Redisから上位10名を取得（スコア付き）
        let rankingData;
        try {
            rankingData = await redis.zrange(rankingKey, 0, 9, {
                rev: true,
                withScores: true,
            });
        } catch (redisErr) {
            console.error('Redis fetch failed, falling back to MongoDB:', redisErr);
        }

        // Redisにデータがない、またはエラーの場合はMongoDBから集計してRedisにセット
        if (!rankingData || rankingData.length === 0) {
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            weekStart.setHours(0, 0, 0, 0);

            const mongoRanking = await LearningSession.aggregate([
                {
                    $match: {
                        startTime: { $gte: weekStart },
                        isActive: false,
                    },
                },
                {
                    $group: {
                        _id: '$userId',
                        totalMinutes: { $sum: '$duration' },
                    },
                },
                { $sort: { totalMinutes: -1 } },
                { $limit: 10 },
            ]);

            // Redisにキャッシュ（パイプラインで一括登録）
            if (mongoRanking.length > 0) {
                const pipeline = redis.pipeline();
                mongoRanking.forEach((item) => {
                    pipeline.zadd(rankingKey, { score: item.totalMinutes, member: item._id.toString() });
                });
                await pipeline.exec();
            }

            // データ形式をRedisの結果に合わせる
            // mongoRanking: [{ _id, totalMinutes }]
            // rankingData (Redis形式): [userId, score, userId, score, ...]
            rankingData = [];
            mongoRanking.forEach(item => {
                rankingData.push(item._id.toString());
                rankingData.push(item.totalMinutes);
            });
        }

        // 2. ユーザー情報を取得して結合
        // rankingDataは [userId1, score1, userId2, score2, ...] のフラット配列
        const rankedUsers = [];
        for (let i = 0; i < rankingData.length; i += 2) {
            const userId = rankingData[i];
            const score = parseInt(rankingData[i + 1]);

            // ユーザー情報を取得（本来はここもキャッシュすべきだが、今回はUserデータ変更への対応簡略化のため都度取得）
            // 必要に応じてUser情報のキャッシュ戦略も検討可能
            const user = await User.findById(userId).select('username profilePicture');

            if (user) {
                rankedUsers.push({
                    userId: user._id,
                    username: user.username,
                    profilePicture: user.profilePicture,
                    totalMinutes: score,
                    rank: (i / 2) + 1,
                });
            }
        }

        res.status(200).json(rankedUsers);
    } catch (err) {
        console.error('Error fetching weekly ranking:', err);
        res.status(500).json({ message: 'ランキング取得に失敗しました' });
    }
});

module.exports = router;
