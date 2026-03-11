// const mongoose = require("mongoose");

// const UserSchema = new mongoose.Schema({
//     googleId:{
//         type : String,
//         unique : true,
//         sparse : true,
//     },
//     email: {
//         type: String,
//         required: true,
//         unique: true,
//         max: 50,
//     },
//     password: {
//         type: String,
//         // required: true, // Google認証ユーザーはパスワードを持たないため、requiredを外す
//         min: 6,
//         max:20,
//     },
//     displayName: {
//         type : String,
//         required : true,
//     },
//     profilePicture: {
//         type: String,
//         default: "",
//     },
//     coverPicture: {
//         type: String,
//         default: "",
//     },
//     followers: {
//         type: Array,
//         default: [],
//     },
//     followings: {
//         type: Array,
//         default: [],
//     },
//     isAdmin: {
//         type: Boolean,
//         default: false,
//     },
//     desc: {
//         type: String,
//         max: 80,
//     },
//     role: {
//         type: String,
//         enum : ['STUDENT', 'TEACHER', 'ADMIN'],
//         default : 'STUDENT',
//     },
//     accessToken: {
//         type: String,
//         secret : false,
//     },
//     refreshToken: {
//         type: String,
//         secret : false,
//     },

//     enlolledCourses: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'Course',
//     }
// }, 
// { timestamps: true }
// );

// module.exports = mongoose.model("User",UserSchema);
// // Userモデルをエクスポート
// // このモデルはユーザー情報をMongoDBに保存するために使用される
// // ユーザー名、メールアドレス、パスワード、プロフィール画像、カバー画像、フォロワー、フォロー中のユーザーなどのフィールドを持つ
// // また、管理者フラグや自己紹介文、居住地などの追加情報も含まれる

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
    },
    googleId: {
      type: String,
    },
    profilePicture: {
      type: String,
    },
    coverPicture: {
      type: String,
      default: "",
    },
    backgroundColor: {
      type: String,
      default: "#ffffff",
    },
    font: {
      type: String,
      default: "Arial",
    },
    desc: {
      type: String,
      max: 50,
      default: "",
    },
    // Add fields to store Google OAuth tokens
    accessToken: {
      type: String,
    },
    refreshToken: {
      type: String,
    },
    fcmToken: {
      type: String,
      default: null,
    },
    followers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    following: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    hasAgreedToPrivacyPolicy: {
      type: Boolean,
      default: false,
    },
    // Cross-Account Protection (RISC) 関連フィールド
    accountLocked: {
      type: Boolean,
      default: false,
    },
    lockedAt: {
      type: Date,
    },
    lockReason: {
      type: String,
    },
    requiresReauth: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);