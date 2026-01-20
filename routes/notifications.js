const router = require("express").Router();
const Notification = require("../models/Notification");
const redisClient = require("../redisClient");

// Get notifications for a user (Redis優先読み込み)
router.get("/:userId", async (req, res) => {
    const userId = req.params.userId;

    try {
        let notifications = [];

        // 1. Redis から取得（存在すればそのまま返す）
        try {
            const cached = await redisClient.lRange(
                `notifications:${userId}`,
                0,
                49
            );
            if (cached && cached.length > 0) {
                notifications = cached.map((item) => JSON.parse(item));
                return res.status(200).json(notifications);
            }
        } catch (redisErr) {
            console.error("Redis fetch error (notifications):", redisErr);
        }

        // 2. Redisに無ければMongoDBから取得し、Redisへシード
        notifications = await Notification.find({ receiver: userId })
            .populate("sender", "username profilePicture")
            .populate("post", "desc img")
            .sort({ createdAt: -1 })
            .limit(50);

        // Mongoの結果をRedisへ保存（将来の読み取りを高速化）
        if (notifications.length > 0) {
            try {
                const pipeline = redisClient.multi();
                pipeline.del(`notifications:${userId}`);
                notifications.forEach((n) => {
                    pipeline.lPush(
                        `notifications:${userId}`,
                        JSON.stringify(n)
                    );
                });
                pipeline.lTrim(`notifications:${userId}`, 0, 49);
                await pipeline.exec();
            } catch (seedErr) {
                console.error("Redis seed error (notifications):", seedErr);
            }
        }

        res.status(200).json(notifications);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Mark notification as read
router.put("/:id/read", async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            req.params.id,
            { isRead: true },
            { new: true }
        );

        // Redis 側もできるだけ整合させる（完全一致でなくベストエフォート）
        if (notification) {
            const userId = notification.receiver.toString();
            try {
                const cached = await redisClient.lRange(
                    `notifications:${userId}`,
                    0,
                    -1
                );
                if (cached && cached.length > 0) {
                    const updatedList = cached.map((item) => {
                        const parsed = JSON.parse(item);
                        if (
                            parsed._id &&
                            parsed._id.toString() === notification._id.toString()
                        ) {
                            parsed.isRead = true;
                        }
                        return JSON.stringify(parsed);
                    });

                    const pipeline = redisClient.multi();
                    pipeline.del(`notifications:${userId}`);
                    updatedList.forEach((v) =>
                        pipeline.lPush(`notifications:${userId}`, v)
                    );
                    pipeline.lTrim(`notifications:${userId}`, 0, 49);
                    await pipeline.exec();
                }
            } catch (redisErr) {
                console.error("Redis sync error (notification read):", redisErr);
            }
        }

        res.status(200).json(notification);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Mark ALL notifications as read for a user
router.put("/read-all/:userId", async (req, res) => {
    try {
        await Notification.updateMany(
            { receiver: req.params.userId, isRead: false },
            { $set: { isRead: true } }
        );

        // Redis 側は一旦破棄し、次回取得時にMongoから再シードさせる
        try {
            await redisClient.del(`notifications:${req.params.userId}`);
        } catch (redisErr) {
            console.error("Redis sync error (notification read-all):", redisErr);
        }

        res.status(200).json("All notifications marked as read");
    } catch (err) {
        res.status(500).json(err);
    }
});

module.exports = router;
