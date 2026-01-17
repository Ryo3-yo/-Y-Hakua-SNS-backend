const router = require("express").Router();
const User = require("../models/User");
const passport = require("passport");

//CRUD
//ユーザー情報の更新

router.put("/:id", async (req, res) => {
  if (req.body.userId === req.params.id || req.body.isAdmin) {
    try {
      const user = await User.findByIdAndUpdate(req.params.id, {
        $set: req.body,
      });
      res.status(200).json("ユーザー情報が更新されました。")
    } catch (err) {
      return res.status(500).json(err);
    }
  } else {
    return res
      .status(403)
      .json("自分のアカウントのみ情報を更新できます。")
  }
});

//ユーザー情報の削除
router.delete("/:id", async (req, res) => {
  if (req.body.userId === req.params.id || req.body.isAdmin) {
    try {
      const user = await User.findByIdAndDelete(req.params.id);
      res.status(200).json("ユーザー情報が削除されました。")
    } catch (err) {
      return res.status(500).json(err);
    }
  } else {
    return res
      .status(403)
      .json("自分のアカウントのみ情報を削除できます。")
  }
});

//ユーザー情報の取得
// router.get("/:id", async(req,res) => {
//      try{
//         const user = await User.findById(req.params.id);
//         const {password, updatedAt,...other} = user._doc;
//         return res.status(200).json(other);
//     }catch(err){
//         return res.status(500).json(err);
//     }

// });

// ユーザー設定の更新
router.get("/:id/settings", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json("ユーザーが見つかりません。");
    }
    const { backgroundColor, font, coverPicture, desc } = user;
    res.status(200).json({ backgroundColor, font, coverPicture, desc });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ユーザー設定の更新
router.put("/:id/settings", passport.authenticate('jwt', { session: false }), async (req, res) => {
  // 認証されたユーザーのIDとリクエストパラメータのIDが一致するか確認
  if (req.user._id.toString() !== req.params.id) {
    return res.status(403).json("自分のアカウントの設定のみ更新できます。");
  }

  try {
    await User.findByIdAndUpdate(req.params.id, {
      $set: {
        backgroundColor: req.body.backgroundColor,
        font: req.body.font,
        coverPicture: req.body.coverPicture,
        desc: req.body.desc,
      },
    });
    res.status(200).json("設定が更新されました。");
  } catch (err) {
    console.error("Settings Update Error:", err);
    res.status(500).json(err);
  }
});

//クエリパラメータによるユーザー情報の取得
router.get("/", async (req, res) => {
  const userId = req.query.userId;
  const username = req.query.username;
  try {
    const user = userId
      ? await User.findById(userId)
      : await User.findOne({ username: username });

    if (!user) {
      return res.status(404).json("User not found");
    }

    const { password, updatedAt, ...other } = user._doc;
    return res.status(200).json(other);
  } catch (err) {
    return res.status(500).json(err);
  }

});

// //follow a user
// router.put("/:id/follow", async (req, res) => {
//   if (req.body.userId !== req.params.id) {
//     try {
//       const user = await User.findById(req.params.id);
//       const currentUser = await User.findById(req.body.userId);
//       //フォロワーにいなかったらフォローできる
//       if (!user.followers.includes(req.body.userId)) {
//         await user.updateOne({ $push: { followers: req.body.userId } });
//         await currentUser.updateOne({ $push: { following: req.params.id } });
//         res.status(200).json("ユーザーをフォローしました");
//       } else {
//         return res.status(403).json("すでにこのユーザーをフォローしています");
//       }
//     } catch (err) {
//       return res.status(500).json(err);
//     }
//   } else {
//     return res.status(500).json("自分をフォローすることはできません");
//   }
// });

//follow a user
router.put("/:id/follow", async (req, res) => {
  if (req.body.userId !== req.params.id) {
    try {
      const user = await User.findById(req.params.id);
      const currentUser = await User.findById(req.body.userId);
      //フォロワーにいなかったらフォローできる
      if (!user.followers.includes(req.body.userId)) {
        await user.updateOne({
          $push: {
            followers: req.body.userId,
          }
        });
        await currentUser.updateOne({
          $push: {
            following: req.params.id
          }
        });
        res.status(200).json("user has been followd");
      } else {
        return res.status(403).json("you allready follow this user");
      }
    } catch (err) {
      return res.status(500).json(err);
    }
  } else {
    return res.status(500).json("cant follow yourself");
  }
});

// //unfollow a user
// router.put("/:id/unfollow", async (req, res) => {
//   if (req.body.userId !== req.params.id) {
//     try {
//       const user = await User.findById(req.params.id);
//       const currentUser = await User.findById(req.body.userId);
//       //フォロワーにいたらフォロー外せる
//       if (user.followers.includes(req.body.userId)) {
//         await user.updateOne({ $pull: { followers: req.body.userId } });
//         await currentUser.updateOne({ $pull: { following: req.params.id } });
//         res.status(200).json("フォローを解除しました");
//       } else {
//         return res.status(403).json("このユーザーをフォローしていません");
//       }
//     } catch (err) {
//       return res.status(500).json(err);
//     }
//   } else {
//     return res.status(500).json("自分をフォローすることはできません");
//   }
// });

//unfollow a user
router.put("/:id/unfollow", async (req, res) => {
  if (req.body.userId !== req.params.id) {
    try {
      const user = await User.findById(req.params.id);
      const currentUser = await User.findById(req.body.userId);
      //フォロワーにいたらフォロー外せる
      if (user.followers.includes(req.body.userId)) {
        await user.updateOne({ $pull: { followers: req.body.userId } });
        await currentUser.updateOne({ $pull: { following: req.params.id } });
        res.status(200).json("user has been unfollowd");
      } else {
        return res.status(403).json("you dont follow this user");
      }
    } catch (err) {
      return res.status(500).json(err);
    }
  } else {
    return res.status(500).json("cant unfollow yourself");
  }
});

// ユーザー検索API
router.get("/search", async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);

  try {
    // 正規表現で部分一致（大文字小文字を無視）
    const users = await User.find({
      $or: [
        { username: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: "i" } },
        { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: "i" } },
      ],
    }).limit(20);

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ユーザー検索に失敗しました" });
  }
});

// Google認証によるユーザー情報の取得
router.get("/me", passport.authenticate('jwt', { session: false }), (req, res) => {
  // パスワードを除いてユーザー情報を返す
  const { password, updatedAt, ...other } = req.user._doc;
  res.status(200).json(other);
});

//get friends (following list)
router.get("/friends/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }

    // following配列が存在しない、または空の場合
    if (!user.following || user.following.length === 0) {
      return res.status(200).json([]);
    }

    const friends = await Promise.all(
      user.following.map((friendId) => {
        return User.findById(friendId);
      })
    );

    let friendList = [];
    friends.forEach((friend) => {
      if (friend) {
        const { _id, username, profilePicture } = friend;
        friendList.push({ _id, username, profilePicture });
      }
    });
    res.status(200).json(friendList);
  } catch (err) {
    console.error("Friends fetch error:", err);
    res.status(500).json({ error: "フレンド取得に失敗しました" });
  }
});

// get followers list
router.get("/followers/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }

    if (!user.followers || user.followers.length === 0) {
      return res.status(200).json([]);
    }

    const followers = await Promise.all(
      user.followers.map((followerId) => {
        return User.findById(followerId);
      })
    );

    let followerList = [];
    followers.forEach((follower) => {
      if (follower) {
        const { _id, username, profilePicture } = follower;
        followerList.push({ _id, username, profilePicture });
      }
    });
    res.status(200).json(followerList);
  } catch (err) {
    console.error("Followers fetch error:", err);
    res.status(500).json({ error: "フォロワー取得に失敗しました" });
  }
});

// プライバシーポリシー
router.put("/:id/agree-privacy", passport.authenticate('jwt', { session: false }), async (req, res) => {
  if (req.user._id.toString() !== req.params.id) {
    return res.status(403).json("自分のアカウントのみ更新できます。");
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { hasAgreedToPrivacyPolicy: true } },
      { new: true }
    );
    const { password, updatedAt, ...other } = updatedUser._doc;
    res.status(200).json(other);
  } catch (err) {
    console.error("Privacy Policy Agreement Error:", err);
    res.status(500).json(err);
  }
});

module.exports = router;