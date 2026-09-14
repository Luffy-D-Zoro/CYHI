const { Router } = require("express");
const { getProgress, getFinalAggregation } = require("../controllers/formController");
const { generateAiAssignments } = require("../controllers/aiController");
const {
  getAssignmentsForReview,
  updateAssignmentByLeader,
  bulkUpdateAssignments,
} = require("../controllers/assignmentController");

const router = Router();

router.get("/:formId/progress", getProgress);
router.get("/:formId/final", getFinalAggregation);

// AI assignment and review routes
router.post("/:formId/ai-assignments", generateAiAssignments);
router.get("/:formId/assignments", getAssignmentsForReview);
router.patch("/:formId/assignments/:fieldId", updateAssignmentByLeader);
router.put("/:formId/assignments/review", bulkUpdateAssignments);

module.exports = router;
