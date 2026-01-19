const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('passport');
const session = require('express-session');
const http = require('http');
const { Server } = require("socket.io");

dotenv.config();

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:5173",
  "https://y-hakua-sns-frontend-29cj.vercel.app"
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

// App全体でioを使えるようにする
app.set('io', io);

// Socket.io ユーザー管理
let users = [];

const addUser = (userId, socketId) => {
  if (!users.some((user) => user.userId === userId)) {
    users.push({ userId, socketId });
  }
};

const removeUser = (socketId) => {
  users = users.filter((user) => user.socketId !== socketId);
};

const getUser = (userId) => {
  return users.find((user) => user.userId === userId);
};

// Socket.io 接続処理
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // ユーザー登録
  socket.on("addUser", (userId) => {
    addUser(userId, socket.id);
    socket.join(userId); // ユーザーIDのルームに参加（これで io.to(userId) が使える）
    io.emit("getUsers", users);
    console.log("User added and joined room:", userId);
  });

  // メッセージ送信
  socket.on("sendMessage", ({ senderId, senderName, senderProfilePicture, receiverId, text, conversationId }) => {
    const user = getUser(receiverId);
    if (user) {
      io.to(user.socketId).emit("getMessage", {
        senderId,
        senderName,
        senderProfilePicture,
        text,
        conversationId,
        createdAt: new Date(),
      });
    }
  });

  // メッセージ既読通知
  socket.on("markAsRead", ({ conversationId, readerId, senderId }) => {
    const sender = getUser(senderId);
    if (sender) {
      io.to(sender.socketId).emit("messageRead", {
        conversationId,
        readerId,
        readAt: new Date(),
      });
    }
  });

  // タイピング中の通知
  socket.on("typing", ({ conversationId, userId, receiverId }) => {
    const user = getUser(receiverId);
    if (user) {
      io.to(user.socketId).emit("userTyping", {
        conversationId,
        userId,
      });
    }
  });

  // タイピング停止の通知
  socket.on("stopTyping", ({ conversationId, userId, receiverId }) => {
    const user = getUser(receiverId);
    if (user) {
      io.to(user.socketId).emit("userStopTyping", {
        conversationId,
        userId,
      });
    }
  });

  // 切断処理
  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
    removeUser(socket.id);
    io.emit("getUsers", users);
  });
});

// ミドルウェア
app.use(helmet());
app.use(morgan('common'));
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});
// Serve static assets from the frontend's public directory
// app.use(express.static('../frontEnd/public'));

// セッション設定
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Passport初期化
app.use(passport.initialize());
app.use(passport.session());

// データベース接続
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Passport設定
require('./config/passport');

// ルート
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/posts', require('./routes/post'));
app.use('/api/classroom', require('./routes/classroom'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/conversations', require('./routes/conversation'));
app.use('/api/messages', require('./routes/message'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/hashtags', require('./routes/hashtag'));
app.use('/api/security', require('./routes/security'));

// サーバー起動
const PORT = process.env.PORT || 8800;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io enabled for real-time messaging`);
});