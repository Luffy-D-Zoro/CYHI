const Form = require("../models/Form");
const ApiError = require("./ApiError");

const SOURCE_TYPES = Form.schema.path("sourceType").enumValues;
const FIELD_TYPES = Form.FIELD_TYPES;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : email;
}

function validateLeader(leader, errors) {
  if (!leader || typeof leader !== "object" || Array.isArray(leader)) {
    errors.push("leader is required.");
    return null;
  }

  // Name is intentionally optional here: Team.members[].name defaults to ""
  // in the schema (see models/Team.js), so there is no data-model reason to
  // force the leader to type their own name again. Only reject it if it was
  // supplied as something other than a string.
  if (leader.name !== undefined && leader.name !== null && typeof leader.name !== "string") {
    errors.push("leader.name must be a string if provided.");
  }
  if (!isNonEmptyString(leader.email)) errors.push("leader.email is required.");
  if (!isNonEmptyString(leader.role)) errors.push("leader.role is required.");

  return {
    name: isNonEmptyString(leader.name) ? leader.name.trim() : "",
    email: normalizeEmail(leader.email),
    role: isNonEmptyString(leader.role) ? leader.role.trim() : "",
  };
}

function validateMember(member, index, errors) {
  const label = `members[${index}]`;
  if (!member || typeof member !== "object" || Array.isArray(member)) {
    errors.push(`${label} must be an object.`);
    return null;
  }

  if (!isNonEmptyString(member.email)) errors.push(`${label}.email is required.`);
  if (!isNonEmptyString(member.role)) errors.push(`${label}.role is required.`);

  return {
    name: typeof member.name === "string" ? member.name.trim() : "",
    email: normalizeEmail(member.email),
    role: isNonEmptyString(member.role) ? member.role.trim() : "",
  };
}

function validateFields(rawFields, errors) {
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    errors.push("fields must be a non-empty array.");
    return [];
  }

  const seenFieldIds = new Set();

  const normalized = rawFields.map((field, i) => {
    if (!field || typeof field !== "object") {
      errors.push(`fields[${i}] must be an object.`);
      return null;
    }

    if (!isNonEmptyString(field.fieldId)) {
      errors.push(`fields[${i}].fieldId is required.`);
    } else if (seenFieldIds.has(field.fieldId)) {
      errors.push(`fields[${i}].fieldId "${field.fieldId}" is duplicated.`);
    } else {
      seenFieldIds.add(field.fieldId);
    }

    if (typeof field.index !== "number") {
      errors.push(`fields[${i}].index must be a number.`);
    }

    if (!FIELD_TYPES.includes(field.type)) {
      errors.push(`fields[${i}].type must be one of: ${FIELD_TYPES.join(", ")}.`);
    }

    return {
      fieldId: field.fieldId,
      index: field.index,
      type: field.type,
      label: typeof field.label === "string" ? field.label : "",
      placeholder: typeof field.placeholder === "string" ? field.placeholder : "",
      required: Boolean(field.required),
      selectors: {
        id: field.selectors?.id || "",
        name: field.selectors?.name || "",
        cssPath: field.selectors?.cssPath || "",
      },
    };
  });

  return normalized;
}

/**
 * Validates and normalizes a POST /api/collaborations body.
 * Throws ApiError(400, ...) with a `details` array of every problem found
 * (not just the first) if anything is invalid. Returns the normalized,
 * ready-to-persist data otherwise.
 */
function validateCollaborationInput(body) {
  const errors = [];
  const b = body && typeof body === "object" ? body : {};

  if (!isNonEmptyString(b.sourceUrl)) {
    errors.push("sourceUrl is required.");
  }

  const sourceType = b.sourceType === undefined ? undefined : b.sourceType;
  if (sourceType !== undefined && !SOURCE_TYPES.includes(sourceType)) {
    errors.push(`sourceType must be one of: ${SOURCE_TYPES.join(", ")}.`);
  }

  const fields = validateFields(b.fields, errors);

  const leader = validateLeader(b.leader, errors);

  let members = [];
  if (b.members !== undefined) {
    if (!Array.isArray(b.members)) {
      errors.push("members must be an array.");
    } else {
      members = b.members.map((m, i) => validateMember(m, i, errors));
    }
  }

  // Duplicate email check across leader + members (case-insensitive, post-normalization).
  const allEmails = [leader?.email, ...members.map((m) => m?.email)].filter(Boolean);
  const seenEmails = new Set();
  for (const email of allEmails) {
    if (seenEmails.has(email)) {
      errors.push(`Duplicate member email: ${email}`);
    }
    seenEmails.add(email);
  }

  if (errors.length > 0) {
    throw new ApiError(400, "Invalid collaboration request.", errors);
  }

  return {
    sourceUrl: b.sourceUrl.trim(),
    sourceType,
    fields,
    leader,
    members,
  };
}

module.exports = validateCollaborationInput;
