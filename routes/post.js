const router = require("express").Router();
const Post = require("../models/Post");
const User = require("../models/User");
const Comment = require("../models/Comment");
const Notification = require("../models/Notification");
const { saveHashtags } = require("./hashtag");

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

      // 通知作成 & 送信 (自分の投稿以外)
      if (post.userId.toString() !== req.body.userId) {
        const notification = new Notification({
          sender: req.body.userId,
          receiver: post.userId,
          type: "like",
          post: post._id,
        });
        await notification.save();

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
      await notification.save();

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

