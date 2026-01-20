const router = require("express").Router();
const Post = require("../models/Post");
const User = require("../models/User");
const Comment = require("../models/Comment");
const Notification = require("../models/Notification");
const { saveHashtags, getTodayDate } = require("./hashtag");
const redisClient = require("../redisClient");

//create a post
router.post("/", async (req, res) => {
  const newPost = new Post(req.body);
  try {
    const savedPost = await newPost.save();

    // Extract and save hashtags from the post description
    if (req.body.desc) {
      await saveHashtags(req.body.desc);
    }

    // 投稿者のフォロワーを取得して通知を送る
    const user = await User.findById(req.body.userId);
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
    return res.status(500).json(err);
  }
});

//update a post
router.put("/:id", async (req, res) => {
  try {
    //投稿したidを取得
    const post = await Post.findById(req.params.id);
    if (post.userId === req.body.userId) {
      await post.updateOne({ $set: req.body });
      res.status(200).json("the post has been updated");
    } else {
      res.status(403).json("you can update only your post");
    }
  } catch (err) {
    res.status(403).json(err);
  }
});

//delete a post
router.delete("/:id", async (req, res) => {
  try {
    //投稿したidを取得
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json("Post not found");
    }
    // ObjectIdを文字列に変換して比較
    if (post.userId.toString() === req.body.userId) {
      await post.deleteOne();
      res.status(200).json("the post has been deleted");
    } else {
      res.status(403).json("you can delete only your post");
    }
  } catch (err) {
    console.error("Delete post error:", err);
    res.status(500).json(err);
  }
});

//like/dislike a post
router.put("/:id/like", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    //まだ投稿にいいねが押されていなかったら
    if (!post.likes.includes(req.body.userId)) {
      await post.updateOne({ $push: { likes: req.body.userId } });

      // いいねランキング用（日本時間3:00区切りの日付キー）をRedisで更新
      try {
        const today = getTodayDate();
        await redisClient.zIncrBy(`likeRanking:${today}`, 1, post._id.toString());
        await redisClient.expire(`likeRanking:${today}`, 60 * 60 * 24 * 14);
      } catch (redisErr) {
        console.error("Redis like ranking incr error:", redisErr);
      }

      // 通知作成 & 送信 (自分の投稿以外)
      if (post.userId.toString() !== req.body.userId) {
        const notification = new Notification({
          sender: req.body.userId,
          receiver: post.userId,
          type: "like",
          post: post._id,
        });
        const savedNotification = await notification.save();

        // Redis sync
        try {
          // Fetch sender details to store in Redis as well (to avoid multiple lookups during retrieval)
          const sender = await User.findById(req.body.userId);
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
        const sender = await User.findById(req.body.userId);

        io.to(post.userId.toString()).emit("getNotification", {
          senderId: req.body.userId,
          senderName: sender.username,
          type: "like",
          postId: post._id,
        });
      }

      res.status(200).json("The post has been liked");
      //すでにいいねが押されていたら
    } else {
      //いいねしているユーザーを取り除く
      await post.updateOne({ $pull: { likes: req.body.userId } });
      // ランキングも可能であればデクリメント（ベストエフォート）
      try {
        const today = getTodayDate();
        await redisClient.zIncrBy(`likeRanking:${today}`, -1, post._id.toString());
      } catch (redisErr) {
        console.error("Redis like ranking decr error:", redisErr);
      }
      res.status(200).json("The post has been disliked");
    }
  } catch (err) {
    res.status(500).json(err);
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
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const allPosts = await Post.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId"
        }
      },
      {
        $unwind: "$userId"
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $skip: skip
      },
      {
        $limit: limit
      }
    ]);
    return res.status(200).json(allPosts);
  } catch (err) {
    console.error("Error in /timeline/all:", err);
    return res.status(500).json(err);
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
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const posts = await Post.find({ userId: user._id })
      .populate("userId", "username profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json(posts);
  } catch (err) {
    console.error("Error in /profile/:username:", err);
    return res.status(500).json(err);
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
    res.status(500).json(err);
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
    return res.status(500).json(err);
  }
});

//get a post
router.get("/:id", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    res.status(200).json(post);
  } catch (err) {
    res.status(500).json(err);
  }
});

//コメントを作成する
router.post("/:id/comment", async (req, res) => {
  try {
    // コメントを作成
    const newComment = new Comment({
      postId: req.params.id,
      userId: req.body.userId,
      desc: req.body.desc,
      img: req.body.img,
    });
    const savedComment = await newComment.save();

    // 該当する投稿のコメント数をインクリメント
    const post = await Post.findByIdAndUpdate(req.params.id, {
      $inc: { comment: 1 },
    });

    // 通知作成 & 送信 (自分の投稿以外)
    if (post.userId.toString() !== req.body.userId) {
      const notification = new Notification({
        sender: req.body.userId,
        receiver: post.userId,
        type: "comment",
        post: post._id,
      });
      const savedNotification = await notification.save();

      // Redis sync
      try {
        const sender = await User.findById(req.body.userId);
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
        await redisClient.lTrim(`notifications:${post.userId}`, 0, 49); // Keep only last 50
      } catch (redisErr) {
        console.error("Redis notification sync error (comment):", redisErr);
      }

      const io = req.app.get('io');
      const sender = await User.findById(req.body.userId);

      io.to(post.userId.toString()).emit("getNotification", {
        senderId: req.body.userId,
        senderName: sender.username,
        type: "comment",
        postId: post._id,
      });
    }

    return res.status(200).json(savedComment);
  } catch (err) {
    return res.status(500).json(err);
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
    res.status(500).json(err);
  }
});

// コメントを削除する
router.delete("/:id/comment/:commentId", async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json("コメントが見つかりません");

    // 削除権限の確認: コメント投稿者のみ
    // 将来的にはPost投稿者も削除できるように拡張可能
    if (comment.userId.toString() === req.body.userId) {
      await comment.deleteOne();

      // 該当する投稿のコメント数をデクリメント
      await Post.findByIdAndUpdate(req.params.id, {
        $inc: { comment: -1 },
      });

      res.status(200).json("コメントが削除されました");
    } else {
      res.status(403).json("自分のコメントのみ削除できます");
    }
  } catch (err) {
    console.error("Delete comment error:", err);
    res.status(500).json(err);
  }
});


module.exports = router;

