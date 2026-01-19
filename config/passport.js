// require('dotenv').config();

// const passport = require('passport');
// const GoogleStrategy = require('passport-google-oauth20').Strategy;
// const User = require('../models/User'); // さっき作ったUserモデル

// passport.use(
//   new GoogleStrategy(
//     {
//       clientID: process.env.GOOGLE_CLIENT_ID,     // GCPで取得したID
//       clientSecret: process.env.GOOGLE_CLIENT_SECRET, // GCPで取得した秘密鍵
//       callbackURL: process.env.GOOGLE_CALLBACK_URL,       // Googleから戻ってくるURL
//       scope: [
//         "profile",
//         "email",
//         // ★★★ Classroom APIのスコープ ★★★
//         // "https://www.googleapis.com/auth/classroom.rosters.readonly", 
//         "https://www.googleapis.com/auth/classroom.courses.readonly",
//         "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
//         // 必要に応じて他のスコープを追加
//       ],
//       accessType: 'offline',
//       prompt: 'consent',
//     },
//     // async (accessToken, refreshToken, profile, done) => {
//     //   // ここが重要！Googleから戻ってきたタイミングで実行されます

//     //   try {
//     //     // 1. すでにDBにいるか確認
//     //     let user = await User.findOne({ googleId: profile.id });

//     //     if (user) {
//     //       // 2. 既存ユーザーならそのままログイン
//     //       // (ここでアクセストークンを保存・更新する場合もあります)
//     //       return done(null, user);
//     //     } else {
//     //       // 3. 新規ユーザーならDBに作成
//     //       const newUser = new User({
//     //         googleId: profile.id,
//     //         email: profile.emails[0].value,
//     //         displayName: profile.displayName,
//     //         avatarUrl: profile.photos[0].value,
//     //         // 必要に応じて role: 'STUDENT' などをここで設定
//     //       });

//     //       await newUser.save();
//     //       return done(null, newUser);
//     //     }
//     //   } catch (err) {
//     //     console.error(err);
//     //     return done(err, null);
//     //   }
//     // }
//     // config/passport.js のStrategy部分
//   // config/passport.js のStrategy部分
//     async (accessToken, refreshToken, profile, done) => {
//       try {
//       // upsert（あれば更新、なければ作成）を使うとスマートです
//         const user = await User.findOneAndUpdate(
//           { googleId: profile.id },
//           {
//             googleId: profile.id,
//             email: profile.emails[0].value,
//             displayName: profile.displayName,
//             avatarUrl: profile.photos[0].value,
//             accessToken: accessToken, // ★ここでトークンを保存/更新
//             refreshToken: refreshToken,
//           },
//           { new: true, upsert: true }
//         );
//         return done(null, user);
//       } catch (err) {
//         // resizeBy.status(500).json(err) // 'resizeBy' is not defined.
//         return done(err, null); // Passportにエラーを伝える
//       }
//     }
//   )
// );

// // セッションにユーザーIDを保存するための設定
// passport.serializeUser((user, done) => {
//   done(null, user.id);
// });

// passport.deserializeUser(async (id, done) => {
//   try {
//     const user = await User.findById(id);
//     done(null, user);
//   } catch (err) {
//     done(err, null);
//   }
// });

require('dotenv').config();

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/classroom.courses.readonly",
      ],
      accessType: 'offline',
      prompt: 'consent',
      pkce: true,
      state: true,
      includeGrantedScopes: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log(`[GoogleStrategy] User ${profile.id} - refreshToken received from Google: ${refreshToken ? 'exists' : 'MISSING'}`);

        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          // User exists, update tokens and other profile info
          user.username = profile.displayName || profile.emails[0].value.split('@')[0];
          user.email = profile.emails[0].value;
          user.profilePicture = profile.photos[0]?.value;
          user.accessToken = accessToken;
          // Only update refreshToken if a new one is provided by Google
          // or if the existing one is missing.
          if (refreshToken) {
            user.refreshToken = refreshToken;
          }
          await user.save();
          console.log(`[GoogleStrategy] Existing user ${user.id} - refreshToken after save: ${user.refreshToken ? 'exists' : 'MISSING'}`);
        } else {
          // New user, create them
          user = new User({
            username: profile.displayName || profile.emails[0].value.split('@')[0],
            email: profile.emails[0].value,
            googleId: profile.id,
            profilePicture: profile.photos[0]?.value,
            accessToken: accessToken,
            refreshToken: refreshToken, // Save if provided on initial login
          });
          await user.save();
          console.log(`[GoogleStrategy] New user ${user.id} - refreshToken after save: ${user.refreshToken ? 'exists' : 'MISSING'}`);
        }
        return done(null, user);
      } catch (error) {
        console.error(`[GoogleStrategy] Error for user ${profile.id}:`, error);
        return done(error, null);
      }
    }
  )
);

const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');

// ... (existing GoogleStrategy code) ...

// JWT Strategy for protecting routes
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET || 'your-jwt-secret',
};

passport.use(
  new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
    try {
      const user = await User.findById(jwt_payload.id);
      if (user) {
        return done(null, user);
      }
      return done(null, false);
    } catch (error) {
      return done(error, false);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    if (user) {
      console.log(`[deserializeUser] User ${user.id} refreshToken: ${user.refreshToken ? 'exists' : 'MISSING'}`);
    } else {
      console.log(`[deserializeUser] User with ID ${id} not found.`);
    }
    done(null, user);
  } catch (err) {
    console.error(`[deserializeUser] Error deserializing user ${id}:`, err);
    done(err, null);
  }
});