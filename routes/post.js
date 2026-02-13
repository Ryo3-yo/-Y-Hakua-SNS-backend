const router = require("express").Router();
const Post = require("../models/Post");
const User = require("../models/User");
const Comment = require("../models/Comment");
const Notification = require("../models/Notification");
const { saveHashtags, getTodayDate } = require("./hashtag");
const redisClient = require("../redisClient");
const { authenticate } = require("../middleware/auth");

//create a post
router.post("/", authenticate, async (req, res) => {
  try {
    // ホワイトリスト方式で投稿作成
    const newPost = new Post({
      userId: req.user._id,
      desc: req.body.desc,
      img: req.body.img,
    });
    const savedPost = await newPost.save();

    // Extract and save hashtags from the post description
    if (req.body.desc) {
      await saveHashtags(req.body.desc);
    }

    // 投稿者のフォロワーを取得して通知を送る
    const user = await User.findById(req.user._id);
    if (user && user.followers && user.followers.length > 0) {
      const io = req.app.get('io');
      user.followers.forEach(followerId => {
        // フォロワーのルームにイベントを送信
        io.to(followerId.toString()).emit("newPost", {
          username: user.username,
          profilePicture: user.profilePicture,
          postId: savedPost._id
        });
      });
    }

    return res.status(200).json(savedPost);
  } catch (err) {
    console.error('Post create error:', err);
    return res.status(500).json({ error: '投稿の作成に失敗しました' });
  }
});

//update a post
router.put("/:id", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });
    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "自分の投稿のみ更新できます" });
    }
    // ホワイトリスト方式で更新
    const allowedFields = ['desc', 'img'];
    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    await post.updateOne({ $set: updates });
    res.status(200).json({ message: "投稿が更新されました" });
  } catch (err) {
    console.error('Post update error:', err);
    res.status(500).json({ error: '投稿の更新に失敗しました' });
  }
});

//delete a post
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: "投稿が見つかりません" });
    }
    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "自分の投稿のみ削除できます" });
    }
    await Comment.deleteMany({ postId: post._id });
    await Notification.deleteMany({ post: post._id });
    await post.deleteOne();
    res.status(200).json({ message: "投稿が削除されました" });
  } catch (err) {
    console.error("Delete post error:", err);
    res.status(500).json({ error: '投稿の削除に失敗しました' });
  }
});

//like/dislike a post
router.put("/:id/like", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });
    const userId = req.user._id.toString();
    //まだ投稿にいいねが押されていなかったら
    if (!post.likes.includes(userId)) {
      await post.updateOne({ $push: { likes: userId } });

      // いいねランキング用（日本時間3:00区切りの日付キー）をRedisで更新
      try {
        const today = getTodayDate();
        await redisClient.zIncrBy(`likeRanking:${today}`, 1, post._id.toString());
        await redisClient.expire(`likeRanking:${today}`, 60 * 60 * 24 * 14);
      } catch (redisErr) {
        console.error("Redis like ranking incr error:", redisErr);
      }

      // 通知作成 & 送信 (自分の投稿以外)
      if (post.userId.toString() !== userId) {
        const notification = new Notification({
          sender: userId,
          receiver: post.userId,
          type: "like",
          post: post._id,
        });
        const savedNotification = await notification.save();

        // Redis sync
        try {
          // Fetch sender details to store in Redis as well (to avoid multiple lookups during retrieval)
          const sender = await User.findById(userId);
          const notificationData = {
            _id: savedNotification._id,
            sender: {
              _id: sender._id,
              username: sender.username,
              profilePicture: sender.profilePicture
            },
            receiver: post.userId,
            type: "like",
            post: post._id,
            createdAt: savedNotification.createdAt,
            isRead: false
          };
          await redisClient.lPush(`notifications:${post.userId}`, JSON.stringify(notificationData));
          await redisClient.lTrim(`notifications:${post.userId}`, 0, 49); // Keep only last 50
        } catch (redisErr) {
          console.error("Redis notification sync error (like):", redisErr);
        }

        const io = req.app.get('io');
        const sender = await User.findById(userId);

        io.to(post.userId.toString()).emit("getNotification", {
          senderId: userId,
          senderName: sender.username,
          type: "like",
          postId: post._id,
        });
      }

      res.status(200).json({ message: "いいねしました" });
      //すでにいいねが押されていたら
    } else {
      //いいねしているユーザーを取り除く
      await post.updateOne({ $pull: { likes: userId } });
      // ランキングも可能であればデクリメント（ベストエフォート）
      try {
        const today = getTodayDate();
        await redisClient.zIncrBy(`likeRanking:${today}`, -1, post._id.toString());
      } catch (redisErr) {
        console.error("Redis like ranking decr error:", redisErr);
      }
      res.status(200).json({ message: "いいねを取り消しました" });
    }
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ error: 'いいね処理に失敗しました' });
  }
});



// //get all post of the user
// router.get("/profile/:username", async (req, res) => {
//   try {
//     const user = await User.findOne({ username: req.params.username });
//     const posts = await Post.find({ userId: user._id });
//     return res.status(200).json(posts);
//   } catch (err) {
//     return res.json(500).json(err);
//   }
// });

// 全ユーザーの投稿（グローバルタイムライン）
router.get("/timeline/all", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;
    const allPosts = await Post.aggregate([
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          desc: 1,
          img: 1,
          likes: 1,
          comment: 1,
          isClassroom: 1,
          createdAt: 1,
          updatedAt: 1,
          userId: {
            _id: "$userInfo._id",
            username: "$userInfo.username",
            profilePicture: "$userInfo.profilePicture"
          }
        }
      }
    ]);
    return res.status(200).json(allPosts);
  } catch (err) {
    console.error("Error in /timeline/all:", err);
    return res.status(500).json({ error: 'タイムラインの取得に失敗しました' });
  }
});

//get only profile timeline posts
router.get("/profile/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json("User not found");
    }
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;

    const posts = await Post.find({ userId: user._id })
      .populate("userId", "username profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json(posts);
  } catch (err) {
    console.error("Error in /profile/:username:", err);
    return res.status(500).json({ error: 'プロフィール投稿の取得に失敗しました' });
  }
});

// //get timeline posts
// router.get("/timeline/user/:userId", async (req, res) => {
//   try {
//     const currentUser = await User.findById(req.params.userId);
//     const userPosts = await Post.find({ userId: currentUser._id });
//     //自分がフォローしている人の投稿を全て取得
//     const friendPosts = await Promise.all(
//       currentUser.followings.map((friendId) => {
//         return Post.find({ userId: friendId });
//       })
//     );
//     return res.status(200).json(userPosts.concat(...friendPosts));
//   } catch (err) {
//     return res.status(500).json(err);
//   }
// });

// router.get("/", (req, res) => {
//   console.log("post page");
// });

router.get('/search', async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.status(400).json({ message: "検索ワードが必要です" });

    // Sanitize query for regex
    const sanitizedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const posts = await Post.find({
      desc: { $regex: sanitizedQuery, $options: 'i' }
    })
      .populate('userId', 'username profilePicture')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(posts);
  } catch (err) {
    console.error("Post search error:", err);
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

// いいねランキング（本日）を取得
// ハッシュタグと同じく、日本時間3:00区切りの日付ごとにランキングを管理
router.get("/like-ranking", async (req, res) => {
  try {
    const today = getTodayDate();
    const key = `likeRanking:${today}`;

    // 1. Redis の ZSET から取得
    try {
      const redisRanking = await redisClient.zRevRangeWithScores(key, 0, 9);
      if (redisRanking && redisRanking.length > 0) {
        const posts = await Promise.all(
          redisRanking.map(async (item) => {
            const post = await Post.findById(item.value).populate(
              "userId",
              "username profilePicture"
            );
            return post
              ? {
                  postId: post._id,
                  rank: 0, // 後で並べ直す
                  count: item.score,
                  desc: post.desc,
                  img: post.img,
                  user: post.userId,
                }
              : null;
          })
        );

        const filtered = posts.filter(Boolean).map((p, index) => ({
          ...p,
          rank: index + 1,
        }));

        return res.status(200).json(filtered);
      }
    } catch (redisErr) {
      console.error("Redis fetch error (like ranking):", redisErr);
    }

    // 2. Redisに無ければMongoDB(Notification)から集計してRedisへシード
    const nowUtc = new Date();
    const jstMillis = nowUtc.getTime() + 9 * 60 * 60 * 1000;
    const endJst = new Date(jstMillis);
    const startJst = new Date(endJst.getTime() - 24 * 60 * 60 * 1000);

    const startUtc = new Date(startJst.getTime() - 9 * 60 * 60 * 1000);
    const endUtc = new Date(endJst.getTime() - 9 * 60 * 60 * 1000);

    const agg = await Notification.aggregate([
      {
        $match: {
          type: "like",
          createdAt: { $gte: startUtc, $lte: endUtc },
          post: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$post",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    if (agg.length === 0) {
      return res.status(200).json([]);
    }

    // 対応する投稿情報を取得
    const postsMap = {};
    const posts = await Post.find({ _id: { $in: agg.map((a) => a._id) } }).populate(
      "userId",
      "username profilePicture"
    );
    posts.forEach((p) => {
      postsMap[p._id.toString()] = p;
    });

    const ranking = agg
      .map((item, index) => {
        const post = postsMap[item._id.toString()];
        if (!post) return null;
        return {
          postId: post._id,
          rank: index + 1,
          count: item.count,
          desc: post.desc,
          img: post.img,
          user: post.userId,
        };
      })
      .filter(Boolean);

    // Redis にシード
    try {
      const pipeline = redisClient.multi();
      pipeline.del(key);
      ranking.forEach((r) => {
        pipeline.zAdd(key, { score: r.count, value: r.postId.toString() });
      });
      pipeline.expire(key, 60 * 60 * 24 * 14);
      await pipeline.exec();
    } catch (seedErr) {
      console.error("Redis seed error (like ranking):", seedErr);
    }

    return res.status(200).json(ranking);
  } catch (err) {
    console.error("Error in /like-ranking:", err);
    return res.status(500).json({ error: 'ランキングの取得に失敗しました' });
  }
});

//get a post
router.get("/:id", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });
    res.status(200).json(post);
  } catch (err) {
    console.error('Get post error:', err);
    res.status(500).json({ error: '投稿の取得に失敗しました' });
  }
});

//コメントを作成する
router.post("/:id/comment", authenticate, async (req, res) => {
  try {
    if (!req.body.desc || req.body.desc.trim().length === 0) {
      return res.status(400).json({ error: 'コメント内容は必須です' });
    }
    if (req.body.desc.length > 500) {
      return res.status(400).json({ error: 'コメントは500文字以内です' });
    }
    const userId = req.user._id;
    // コメントを作成
    const newComment = new Comment({
      postId: req.params.id,
      userId: userId,
      desc: req.body.desc,
      img: req.body.img,
    });
    const savedComment = await newComment.save();

    // 該当する投稿のコメント数をインクリメント
    const post = await Post.findByIdAndUpdate(req.params.id, {
      $inc: { comment: 1 },
    });

    // 通知作成 & 送信 (自分の投稿以外)
    if (post.userId.toString() !== userId.toString()) {
      const notification = new Notification({
        sender: userId,
        receiver: post.userId,
        type: "comment",
        post: post._id,
      });
      const savedNotification = await notification.save();

      // Redis sync
      try {
        const sender = await User.findById(userId);
        const notificationData = {
          _id: savedNotification._id,
          sender: {
            _id: sender._id,
            username: sender.username,
            profilePicture: sender.profilePicture
          },
          receiver: post.userId,
          type: "comment",
          post: post._id,
          createdAt: savedNotification.createdAt,
          isRead: false
        };
        await redisClient.lPush(`notifications:${post.userId}`, JSON.stringify(notificationData));
        await redisClient.lTrim(`notifications:${post.userId}`, 0, 49);
      } catch (redisErr) {
        console.error("Redis notification sync error (comment):", redisErr);
      }

      const io = req.app.get('io');
      const sender = await User.findById(userId);

      io.to(post.userId.toString()).emit("getNotification", {
        senderId: userId,
        senderName: sender.username,
        type: "comment",
        postId: post._id,
      });
    }

    return res.status(200).json(savedComment);
  } catch (err) {
    console.error('Comment create error:', err);
    return res.status(500).json({ error: 'コメントの作成に失敗しました' });
  }
});

//コメントを取得する
router.get("/:id/comments", async (req, res) => {
  try {
    const comments = await Comment.find({ postId: req.params.id })
      .populate("userId", "username profilePicture")
      .sort({ createdAt: -1 });
    res.status(200).json(comments);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'コメントの取得に失敗しました' });
  }
});

// コメントを削除する
router.delete("/:id/comment/:commentId", authenticate, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment || comment.postId.toString() !== req.params.id) {
      return res.status(404).json({ error: "コメントが見つかりません" });
    }

    // 削除権限の確認: コメント投稿者のみ
    if (comment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "自分のコメントのみ削除できます" });
    }
    await Comment.findByIdAndDelete(req.params.commentId);

    // 該当する投稿のコメント数をデクリメント
    await Post.findByIdAndUpdate(req.params.id, {
      $inc: { comment: -1 },
    });

    res.status(200).json({ message: "コメントが削除されました" });
  } catch (err) {
    console.error("Delete comment error:", err);
    res.status(500).json({ error: 'コメントの削除に失敗しました' });
  }
});


module.exports = router;

