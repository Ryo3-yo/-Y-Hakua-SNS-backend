const mongoose = require('mongoose');

const learningGoalSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        type: {
            type: String,
            enum: ['daily', 'weekly', 'monthly'],
            required: true,
        },
        targetMinutes: {
            type: Number,
            required: true,
            min: 1,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

// ユーザーごとに各タイプは1つだけ許可
learningGoalSchema.index({ userId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('LearningGoal', learningGoalSchema);
