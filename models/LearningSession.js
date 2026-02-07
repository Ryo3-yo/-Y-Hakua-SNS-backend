const mongoose = require('mongoose');

const learningSessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        subject: {
            type: String,
            default: '',
        },
        startTime: {
            type: Date,
            required: true,
        },
        endTime: {
            type: Date,
        },
        duration: {
            type: Number, // 学習時間（分）
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

// インデックスを追加（クエリ最適化）
learningSessionSchema.index({ userId: 1, startTime: -1 });
learningSessionSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('LearningSession', learningSessionSchema);
