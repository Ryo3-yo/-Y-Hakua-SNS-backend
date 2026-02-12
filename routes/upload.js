const router = require("express").Router();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const sharp = require("sharp");
const { Readable } = require("stream");
const dotenv = require("dotenv");
const { authenticate } = require("../middleware/auth");

dotenv.config();

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 許可するMIMEタイプ
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

// 画像圧縮のパラメータ
const TARGET_MAX_BYTES = 1 * 1024 * 1024; // 1MB以下を目標
const DIMENSION_STEPS = [1600, 1400, 1200, 1000];
const QUALITY_STEPS = [75, 65, 55, 45, 35];
// 動画圧縮（Cloudinary側でのトランスコード設定）
const VIDEO_MAX_DIMENSION = 1280;
const VIDEO_BITRATE = "1500k"; // 目安ビットレート

// メモリストレージで受け取り、sharpで圧縮してからCloudinaryへストリームアップロード
const storage = multer.memoryStorage();

// ファイルフィルター
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('許可されていないファイル形式です'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: fileFilter,
});

// 画像を1MB以下に近づけるための圧縮（段階的にリサイズ＋品質調整）
const compressToUnderTarget = async (buffer) => {
  for (const dim of DIMENSION_STEPS) {
    for (const quality of QUALITY_STEPS) {
      const output = await sharp(buffer)
        .rotate()
        .resize({ width: dim, height: dim, fit: "inside" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (output.length <= TARGET_MAX_BYTES) {
        return output;
      }
      buffer = output; // 次のループではこれをさらに圧縮する
    }
  }
  return buffer; // これ以上は落とさないが、最終圧縮結果を返す
};

router.post("/", authenticate, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error("Multer error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "ファイルサイズが大きすぎます (上限100MB)" });
      }
      return res.status(400).json({ error: "ファイルアップロードエラー" });
    } else if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message || "アップロードに失敗しました" });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: "ファイルが選択されていません" });
      }

      const isImage = ALLOWED_IMAGE_TYPES.includes(req.file.mimetype);
      const isVideo = ALLOWED_VIDEO_TYPES.includes(req.file.mimetype);
      let uploadBuffer = req.file.buffer;
      let resource_type = isImage ? "image" : "video";

      // 画像の場合のみ、1MB以下を目標に段階的圧縮（rotateでEXIF補正）
      if (isImage && uploadBuffer.length > TARGET_MAX_BYTES) {
        uploadBuffer = await compressToUnderTarget(uploadBuffer);
      }

      const folder = req.query.type === "post" ? "post" : req.query.type === "cover" ? "cover" : "others";
      const public_id = Date.now() + "-" + req.file.originalname.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, '_');

      const options = {
        resource_type,
        folder,
        public_id,
        format: isImage ? "jpg" : "mp4",
      };

      // 動画はCloudinary側でリミット＋ビットレートを指定して転送量を抑える
      if (isVideo) {
        options.transformation = [{
          width: VIDEO_MAX_DIMENSION,
          height: VIDEO_MAX_DIMENSION,
          crop: "limit",
          bit_rate: VIDEO_BITRATE,
          quality: "auto:good",
          fetch_format: "mp4",
        }];
      }

      const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          return res.status(400).json({ error: "Cloudinaryへのアップロードに失敗しました" });
        }
        console.log("File uploaded successfully to Cloudinary:", result.secure_url);
        return res.status(200).json({ filePath: result.secure_url });
      });

      Readable.from(uploadBuffer).pipe(uploadStream);
    } catch (err) {
      console.error("Upload processing error:", err);
      res.status(500).json({ error: "アップロード処理に失敗しました" });
    }
  });
});

module.exports = router;