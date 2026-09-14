const mongoose = require("mongoose");
const Form = require("../models/Form");
const Team = require("../models/Team");
const Assignment = require("../models/Assignment");
const ApiError = require("../utils/ApiError");
const { generateAiAssignmentsForForm } = require("./aiService");

/**
 * Generates initial field assignments using AI (or heuristic fallback) and stores them.
 * Never overwrites assignments where source === "leader".
 */
async function generateAiAssignments(formId, teamId) {
  if (!mongoose.Types.ObjectId.isValid(formId)) {
    throw new ApiError(400, `Invalid formId: "${formId}".`);
  }

  if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
    throw new ApiError(400, `Invalid or missing teamId: "${teamId}".`);
  }

  const form = await Form.findById(formId).lean();
  if (!form) {
    throw new ApiError(404, "Form not found.");
  }

  const team = await Team.findById(teamId).lean();
  if (!team) {
    throw new ApiError(404, "Team not found.");
  }

  if (team.formId.toString() !== form._id.toString()) {
    throw new ApiError(400, "Team does not belong to this form.");
  }

  if (!form.fields || form.fields.length === 0) {
    throw new ApiError(400, "Form has no fields to assign.");
  }

  // Generate and strictly validate AI suggestions
  const validAssignments = await generateAiAssignmentsForForm(form, team);

  // Fetch existing assignments to check for leader overrides
  const existingAssignments = await Assignment.find({ formId }).lean();
  const existingMap = new Map(existingAssignments.map((a) => [a.fieldId, a]));

  const protectedFields = [];
  const bulkOps = [];

  for (const item of validAssignments) {
    const existing = existingMap.get(item.fieldId);

    // Leader choices ALWAYS win: never overwrite leader assignments
    if (existing && existing.source === "leader") {
      protectedFields.push(item.fieldId);
      continue;
    }

    // Non-leader assignments (either new or previously suggested by AI) are upserted
    bulkOps.push({
      updateOne: {
        filter: { formId, fieldId: item.fieldId },
        update: {
          $set: {
            formId,
            fieldId: item.fieldId,
            memberId: new mongoose.Types.ObjectId(item.memberId),
            source: "ai",
            confidence: item.confidence,
            reason: item.reason,
            status: "pending",
          },
        },
        upsert: true,
      },
    });
  }

  if (bulkOps.length > 0) {
    await Assignment.bulkWrite(bulkOps);
  }

  // Return the complete current assignment set
  const currentAssignments = await Assignment.find({ formId }).lean();

  return {
    assignments: currentAssignments,
    protectedFields,
  };
}

/**
 * Retrieves flat assignment rows and grouped member columns for the leader review UI.
 */
async function getAssignmentsForReview(formId, teamId) {
  if (!mongoose.Types.ObjectId.isValid(formId)) {
    throw new ApiError(400, `Invalid formId: "${formId}".`);
  }

  if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
    throw new ApiError(400, `Invalid or missing teamId: "${teamId}".`);
  }

  const form = await Form.findById(formId).lean();
  if (!form) {
    throw new ApiError(404, "Form not found.");
  }

  const team = await Team.findById(teamId).lean();
  if (!team) {
    throw new ApiError(404, "Team not found.");
  }

  if (team.formId.toString() !== form._id.toString()) {
    throw new ApiError(400, "Team does not belong to this form.");
  }

  const assignments = await Assignment.find({ formId }).lean();

  const fieldMap = new Map(form.fields.map((f) => [f.fieldId, f]));
  const memberMap = new Map(team.members.map((m) => [m._id.toString(), m]));

  // Flat rows
  const flatAssignments = assignments.map((a) => {
    const field = fieldMap.get(a.fieldId);
    const member = memberMap.get(a.memberId.toString());

    return {
      fieldId: a.fieldId,
      label: field ? field.label : "",
      type: field ? field.type : "",
      required: field ? Boolean(field.required) : false,
      memberId: a.memberId,
      memberEmail: member ? member.email : "",
      memberRole: member ? member.role : "",
      source: a.source,
      confidence: a.confidence,
      reason: a.reason || "",
      status: a.status || "pending",
    };
  });

  // Grouped by team member
  const grouped = team.members.map((m) => {
    const memberAssignments = assignments.filter(
      (a) => a.memberId.toString() === m._id.toString()
    );

    const fields = memberAssignments.map((a) => {
      const field = fieldMap.get(a.fieldId);
      return {
        fieldId: a.fieldId,
        label: field ? field.label : "",
        type: field ? field.type : "",
        required: field ? Boolean(field.required) : false,
        source: a.source,
        confidence: a.confidence,
        reason: a.reason || "",
        status: a.status || "pending",
      };
    });

    return {
      memberId: m._id,
      email: m.email,
      role: m.role,
      isLeader: Boolean(m.isLeader),
      fields,
    };
  });

  return {
    formId: form._id,
    teamId: team._id,
    assignments: flatAssignments,
    grouped,
  };
}

/**
 * Updates a field assignment by leader drag & drop, setting source="leader".
 */
async function updateAssignmentByLeader(formId, fieldId, teamId, memberId) {
  if (!mongoose.Types.ObjectId.isValid(formId)) {
    throw new ApiError(400, `Invalid formId: "${formId}".`);
  }

  if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
    throw new ApiError(400, `Invalid or missing teamId: "${teamId}".`);
  }

  if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, `Invalid or missing memberId: "${memberId}".`);
  }

  const form = await Form.findById(formId).lean();
  if (!form) {
    throw new ApiError(404, "Form not found.");
  }

  const team = await Team.findById(teamId).lean();
  if (!team) {
    throw new ApiError(404, "Team not found.");
  }

  if (team.formId.toString() !== form._id.toString()) {
    throw new ApiError(400, "Team does not belong to this form.");
  }

  const fieldExists = form.fields.some((f) => f.fieldId === fieldId);
  if (!fieldExists) {
    throw new ApiError(404, `Field "${fieldId}" does not belong to this form.`);
  }

  const member = team.members.find((m) => m._id.toString() === memberId.toString());
  if (!member) {
    throw new ApiError(400, `Member "${memberId}" does not belong to this team.`);
  }

  // Update assignment with leader provenance, clearing AI confidence
  const update = {
    $set: {
      formId,
      fieldId,
      memberId: member._id,
      source: "leader",
      status: "pending",
      reason: "Assigned by leader",
    },
    $unset: {
      confidence: 1,
    },
  };

  const assignment = await Assignment.findOneAndUpdate({ formId, fieldId }, update, {
    new: true,
    upsert: true,
    runValidators: true,
  });

  return assignment;
}

/**
 * Bulk updates assignments by leader.
 */
async function bulkUpdateAssignments(formId, teamId, assignments) {
  if (!mongoose.Types.ObjectId.isValid(formId)) {
    throw new ApiError(400, `Invalid formId: "${formId}".`);
  }

  if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
    throw new ApiError(400, `Invalid or missing teamId: "${teamId}".`);
  }

  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new ApiError(400, "assignments must be a non-empty array.");
  }

  const form = await Form.findById(formId).lean();
  if (!form) throw new ApiError(404, "Form not found.");

  const team = await Team.findById(teamId).lean();
  if (!team) throw new ApiError(404, "Team not found.");

  if (team.formId.toString() !== form._id.toString()) {
    throw new ApiError(400, "Team does not belong to this form.");
  }

  const formFieldIds = new Set(form.fields.map((f) => f.fieldId));
  const teamMemberIds = new Set(team.members.map((m) => m._id.toString()));

  const seenFieldIds = new Set();
  for (const a of assignments) {
    if (!a.fieldId || !formFieldIds.has(a.fieldId)) {
      throw new ApiError(400, `Invalid fieldId in bulk update: "${a.fieldId}".`);
    }
    if (seenFieldIds.has(a.fieldId)) {
      throw new ApiError(400, `Duplicate fieldId in bulk update: "${a.fieldId}".`);
    }
    seenFieldIds.add(a.fieldId);

    if (!a.memberId || !teamMemberIds.has(a.memberId.toString())) {
      throw new ApiError(400, `Invalid memberId in bulk update: "${a.memberId}".`);
    }
  }

  const bulkOps = assignments.map((a) => ({
    updateOne: {
      filter: { formId, fieldId: a.fieldId },
      update: {
        $set: {
          formId,
          fieldId: a.fieldId,
          memberId: new mongoose.Types.ObjectId(a.memberId),
          source: "leader",
          status: "pending",
          reason: a.reason || "Assigned by leader",
        },
        $unset: {
          confidence: 1,
        },
      },
      upsert: true,
    },
  }));

  await Assignment.bulkWrite(bulkOps);

  const updatedAssignments = await Assignment.find({ formId }).lean();

  return {
    updatedCount: bulkOps.length,
    assignments: updatedAssignments,
  };
}

module.exports = {
  generateAiAssignments,
  getAssignmentsForReview,
  updateAssignmentByLeader,
  bulkUpdateAssignments,
};
