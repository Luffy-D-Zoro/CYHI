const assignmentService = require("../services/assignmentService");

/**
 * POST /api/forms/:formId/ai-assignments
 * Generates initial field assignments using AI and stores them.
 * Never overwrites assignments where source === "leader".
 */
async function generateAiAssignments(req, res, next) {
  try {
    const { formId } = req.params;
    const { teamId } = req.body;

    const result = await assignmentService.generateAiAssignments(formId, teamId);

    res.status(200).json({
      success: true,
      assignments: result.assignments,
      protectedFields: result.protectedFields,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateAiAssignments,
};
