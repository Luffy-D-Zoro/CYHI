const assignmentService = require("../services/assignmentService");

/**
 * GET /api/forms/:formId/assignments?teamId=...
 * Provides flat assignment rows and grouped member columns for the leader review UI.
 */
async function getAssignmentsForReview(req, res, next) {
  try {
    const { formId } = req.params;
    const { teamId } = req.query;

    const data = await assignmentService.getAssignmentsForReview(formId, teamId);

    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/forms/:formId/assignments/:fieldId
 * Leader drags a field to another member. Sets source="leader" and clears AI confidence.
 */
async function updateAssignmentByLeader(req, res, next) {
  try {
    const { formId, fieldId } = req.params;
    const { teamId, memberId } = req.body;

    const assignment = await assignmentService.updateAssignmentByLeader(
      formId,
      fieldId,
      teamId,
      memberId
    );

    res.json({
      success: true,
      assignment,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/forms/:formId/assignments/review
 * Bulk assignment review endpoint.
 */
async function bulkUpdateAssignments(req, res, next) {
  try {
    const { formId } = req.params;
    const { teamId, assignments } = req.body;

    const result = await assignmentService.bulkUpdateAssignments(formId, teamId, assignments);

    res.json({
      success: true,
      updatedCount: result.updatedCount,
      assignments: result.assignments,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAssignmentsForReview,
  updateAssignmentByLeader,
  bulkUpdateAssignments,
};
