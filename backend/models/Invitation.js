const mongoose = require("mongoose");
const { Schema } = mongoose;
const { randomBytes } = require("crypto");

const invitationSchema = new Schema(
  {
    formId: { type: Schema.Types.ObjectId, ref: "Form", required: true },
    memberId: { type: Schema.Types.ObjectId, required: true }, // Team.members[]._id
    email: { type: String, required: true, trim: true, lowercase: true },
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => randomBytes(6).toString("base64url"), // short, URL-safe, e.g. "8fK29x"-style
    },
    status: {
      type: String,
      enum: ["pending", "opened", "completed"],
      default: "pending",
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true } // createdAt covers the spec's "createdAt" field
);

module.exports = mongoose.model("Invitation", invitationSchema);
