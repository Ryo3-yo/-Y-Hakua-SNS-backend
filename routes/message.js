const router = require("express").Router();
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { authenticate } = require("../middleware/auth");

// メッセージ追加
router.post("/", authenticate, async (req, res) => {
  try {
    const { conversationId, text, attachments } = req.body;
    const sender = req.user._id;

    // 会話メンバーシップの確認
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.members.map(m => m.toString()).includes(sender.toString())) {
      return res.status(403).json({ error: "この会話にメッセージを送る権限がありません" });
    }

    const newMessage = new Message({
      conversationId,
      sender,
      text,
      attachments: attachments || [],
    });

    const savedMessage = await newMessage.save();

    // 送信者の情報を取得（UI表示用）
    const populatedMessage = await Message.findById(savedMessage._id).populate("sender", "username profilePicture");

    // 会話の最新メッセージを更新
    conversation.lastMessage = savedMessage._id;
    conversation.lastMessageText = text;
    conversation.lastMessageAt = savedMessage.createdAt;

    // 送信者以外のメンバーの未読カウントを増やす
    conversation.members.forEach((memberId) => {
      if (memberId.toString() !== sender.toString()) {
        const currentCount = conversation.unreadCount.get(memberId.toString()) || 0;
        conversation.unreadCount.set(memberId.toString(), currentCount + 1);
      }
    });

    await conversation.save();

    res.status(201).json(populatedMessage);
  } catch (err) {
    console.error("Message create error:", err);
    res.status(500).json({ error: "メッセージの送信に失敗しました" });
  }
});

// 会話内のメッセージ取得
router.get("/:conversationId", authenticate, async (req, res) => {
  try {
    // 会話メンバーシップの確認
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || !conversation.members.map(m => m.toString()).includes(req.user._id.toString())) {
      return res.status(403).json({ error: "この会話を閲覧する権限がありません" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    const messages = await Message.find({
      conversationId: req.params.conversationId,
      deletedAt: null,
    })
      .populate("sender", "username profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json(messages);
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "メッセージの取得に失敗しました" });
  }
});

// メッセージ編集
router.put("/:messageId", authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    // 送信者のみ編集可能
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "このメッセージを編集する権限がありません" });
    }

    message.text = text;
    message.edited = true;
    message.editedAt = new Date();

    const updatedMessage = await message.save();

    // 会話の最新メッセージも更新（最新メッセージの場合）
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage?.toString() === message._id.toString()) {
      conversation.lastMessageText = text;
      await conversation.save();
    }

    res.status(200).json(updatedMessage);
  } catch (err) {
    console.error("Message edit error:", err);
    res.status(500).json({ error: "メッセージの編集に失敗しました" });
  }
});

// メッセージ削除（物理削除）
router.delete("/:messageId", authenticate, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    // 送信者のみ削除可能
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "このメッセージを削除する権限がありません" });
    }

    await Message.findByIdAndDelete(req.params.messageId);

    // 会話の最新メッセージを更新（削除されたメッセージが最新だった場合）
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage?.toString() === message._id.toString()) {
      const lastActiveMessage = await Message.findOne({
        conversationId: message.conversationId,
      }).sort({ createdAt: -1 });

      if (lastActiveMessage) {
        conversation.lastMessage = lastActiveMessage._id;
        conversation.lastMessageText = lastActiveMessage.text;
        conversation.lastMessageAt = lastActiveMessage.createdAt;
      } else {
        conversation.lastMessage = null;
        conversation.lastMessageText = null;
        conversation.lastMessageAt = null;
      }
      await conversation.save();
    }

    res.status(200).json({ message: "メッセージを削除しました" });
  } catch (err) {
    console.error("Message delete error:", err);
    res.status(500).json({ error: "メッセージの削除に失敗しました" });
  }
});

// 単一メッセージを既読にする
router.put("/:messageId/read", authenticate, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    // 送信者以外が既読にする
    if (message.sender.toString() !== req.user._id.toString() && !message.read) {
      message.read = true;
      message.readAt = new Date();
      await message.save();
    }

    res.status(200).json(message);
  } catch (err) {
    console.error("Message read error:", err);
    res.status(500).json({ error: "既読の更新に失敗しました" });
  }
});

// 会話内の全メッセージを既読にする
router.put("/read-all/:conversationId", authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { conversationId } = req.params;

    // 会話メンバーシップの確認
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.members.map(m => m.toString()).includes(userId)) {
      return res.status(403).json({ error: "この会話にアクセスする権限がありません" });
    }

    // 送信者以外が既読にする
    await Message.updateMany(
      {
        conversationId,
        sender: { $ne: req.user._id },
        read: false,
        deletedAt: null,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      }
    );

    // 会話の未読カウントをリセット
    conversation.unreadCount.set(userId, 0);
    await conversation.save();

    res.status(200).json({ message: "すべてのメッセージを既読にしました" });
  } catch (err) {
    console.error("Read all error:", err);
    res.status(500).json({ error: "既読の更新に失敗しました" });
  }
});

// 未読メッセージ数を取得
router.get("/unread/count", authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // ユーザーが参加している全会話を取得
    const conversations = await Conversation.find({
      members: req.user._id,
    });

    let totalUnread = 0;
    const unreadByConversation = {};

    for (const conv of conversations) {
      const count = conv.unreadCount.get(userId) || 0;
      totalUnread += count;
      unreadByConversation[conv._id] = count;
    }

    res.status(200).json({
      total: totalUnread,
      byConversation: unreadByConversation,
    });
  } catch (err) {
    console.error("Unread count error:", err);
    res.status(500).json({ error: "未読数の取得に失敗しました" });
  }
});

module.exports = router;
