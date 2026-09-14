const mongoose = require("mongoose");
const Invitation = require("../models/Invitation");
const Form = require("../models/Form");
const Assignment = require("../models/Assignment");
const Response = require("../models/Response");
const ApiError = require("../utils/ApiError");

async function getInvitation(req, res, next) {
  try {
    const { token } = req.params;
    const invitation = await Invitation.findOne({ token }).lean();
    if (!invitation) throw new ApiError(404, "Invalid or expired invitation token.");

    const form = await Form.findById(invitation.formId).lean();
    if (!form) throw new ApiError(404, "Form not found.");

    const assignments = await Assignment.find({ formId: form._id, memberId: invitation.memberId }).lean();
    
    // Create a map of assigned fieldIds
    const assignedFieldIds = new Set(assignments.map(a => a.fieldId));
    
    // Only return fields assigned to this member
    const fields = form.fields.filter(f => assignedFieldIds.has(f.fieldId)).map(f => ({
      fieldId: f.fieldId,
      type: f.type,
      label: f.label,
      placeholder: f.placeholder,
      required: f.required
    }));

    // Mark as opened
    if (invitation.status === "pending") {
      await Invitation.updateOne({ _id: invitation._id }, { status: "opened" });
    }

    res.json({
      formId: form._id,
      memberId: invitation.memberId,
      token: invitation.token,
      fields
    });
  } catch (err) {
    next(err);
  }
}

async function submitResponse(req, res, next) {
  try {
    const { token } = req.params;
    const { responses } = req.body;

    if (!Array.isArray(responses) || responses.length === 0) {
      throw new ApiError(400, "responses must be a non-empty array");
    }

    const invitation = await Invitation.findOne({ token }).lean();
    if (!invitation) throw new ApiError(404, "Invalid or expired invitation token.");

    // Validate field ownership
    const assignments = await Assignment.find({ formId: invitation.formId, memberId: invitation.memberId }).lean();
    const assignedFieldIds = new Set(assignments.map(a => a.fieldId));

    // Validate the ENTIRE batch up front. Nothing is written to Mongo until
    // every response in the batch passes — previously this check ran inside
    // an Array.map() alongside the actual Response.findOneAndUpdate() calls,
    // so a bad field later in the array threw only after earlier
    // findOneAndUpdate() calls had already fired against MongoDB (calling an
    // async mongoose method starts the write immediately, whether or not the
    // resulting promise is later awaited/caught). That let partial writes
    // through on a batch that should have been rejected wholesale.
    const seenFieldIds = new Set();
    for (const r of responses) {
      if (!r || typeof r.fieldId !== "string" || !r.fieldId) {
        throw new ApiError(400, "Each response must include a fieldId.");
      }
      if (!assignedFieldIds.has(r.fieldId)) {
        throw new ApiError(403, `Not authorized to submit fieldId: ${r.fieldId}`);
      }
      if (seenFieldIds.has(r.fieldId)) {
        throw new ApiError(400, `Duplicate fieldId in submission batch: ${r.fieldId}`);
      }
      seenFieldIds.add(r.fieldId);
    }

    // Only now, after the whole batch is known-valid, do we touch the DB.
    // Uses the existing Response schema/unique index (formId+fieldId+memberId)
    // via upsert, so a resubmission of the same field updates the existing
    // document instead of creating a duplicate.
    const bulkOps = responses.map((r) => ({
      updateOne: {
        filter: { formId: invitation.formId, fieldId: r.fieldId, memberId: invitation.memberId },
        update: { $set: { value: r.value } },
        upsert: true,
      },
    }));

    const bulkResult = await Response.bulkWrite(bulkOps, { ordered: true });

    // Don't claim success unless MongoDB actually confirms the writes.
    const confirmedCount =
      (bulkResult.upsertedCount || 0) + (bulkResult.modifiedCount || 0) + (bulkResult.matchedCount || 0);
    if (confirmedCount < responses.length) {
      throw new ApiError(500, "Some responses failed to persist to MongoDB.");
    }

    await Invitation.updateOne({ _id: invitation._id }, { status: "completed" });
    await Assignment.updateMany(
      { formId: invitation.formId, memberId: invitation.memberId, fieldId: { $in: responses.map((r) => r.fieldId) } },
      { $set: { status: "completed" } }
    );

    res.json({ success: true, savedCount: responses.length });
  } catch (err) {
    next(err);
  }
}

module.exports = { getInvitation, submitResponse };
