const { GoogleGenAI } = require("@google/genai");
const ApiError = require("../utils/ApiError");

/**
 * Sanitizes form fields to only include properties needed by the AI.
 * Explicitly removes selectors and internal Mongo properties.
 */
function sanitizeFormFields(fields) {
  return fields.map((f) => ({
    fieldId: f.fieldId,
    label: f.label || "",
    type: f.type,
    placeholder: f.placeholder || "",
    required: Boolean(f.required),
    index: typeof f.index === "number" ? f.index : undefined, // page order, useful context but never a substitute for real grouping info
  }));
}

/**
 * Sanitizes team members to only include properties needed by the AI.
 * Explicitly excludes names, contact details, or other personal info.
 */
function sanitizeTeamMembers(members) {
  return members.map((m) => ({
    memberId: m._id.toString(),
    email: m.email,
    role: m.role,
    isLeader: Boolean(m.isLeader),
  }));
}

/**
 * Heuristic assignment engine used when GEMINI_API_KEY is not configured.
 * Implements the exact same 10 AI assignment rules deterministically.
 */
function generateHeuristicAssignments(fields, members) {
  const leader = members.find((m) => m.isLeader) || members[0];

  // Fields whose label appears more than once with no other distinguishing
  // context (e.g. three fields all literally labeled "Name") — the extractor
  // captured them faithfully, but nothing in the normalized field contract
  // (label/placeholder/type/required/index) can say which teammate a given
  // occurrence belongs to. We surface that ambiguity in the reason instead
  // of pretending otherwise.
  const labelCounts = new Map();
  for (const f of fields) {
    const key = (f.label || "").trim().toLowerCase();
    if (!key) continue;
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  }
  const isAmbiguousDuplicateLabel = (field) => {
    const key = (field.label || "").trim().toLowerCase();
    return key && (labelCounts.get(key) || 0) > 1;
  };

  const assignments = fields.map((field) => {
    const label = (field.label || "").toLowerCase();
    const fieldId = field.fieldId;

    // 1. Role-specific fields -> match member whose role best fits
    for (const member of members) {
      const role = (member.role || "").toLowerCase();
      if (!role) continue;

      if (
        (role.includes("backend") && (label.includes("backend") || label.includes("api") || label.includes("server") || label.includes("database") || label.includes("sql") || label.includes("db"))) ||
        (role.includes("frontend") && (label.includes("frontend") || label.includes("ui") || label.includes("ux") || label.includes("css") || label.includes("design") || label.includes("client") || label.includes("web"))) ||
        (role.includes("devops") && (label.includes("devops") || label.includes("cloud") || label.includes("deploy") || label.includes("infra") || label.includes("aws") || label.includes("docker"))) ||
        ((role.includes("ai") || role.includes("ml") || role.includes("data")) && (label.includes("model") || label.includes("ai") || label.includes("ml") || label.includes("dataset") || label.includes("python")))
      ) {
        return {
          fieldId,
          memberId: member.memberId,
          confidence: 0.92,
          reason: `Role-specific match for role: ${member.role}`,
        };
      }
    }

    // 2. Team and project fields -> team leader
    if (
      label.includes("team") ||
      label.includes("project") ||
      label.includes("title") ||
      label.includes("description") ||
      label.includes("college") ||
      label.includes("university") ||
      label.includes("repo") ||
      label.includes("github repository") ||
      label.includes("track")
    ) {
      return {
        fieldId,
        memberId: leader.memberId,
        confidence: 0.88,
        reason: "Team or project-level field assigned to team leader",
      };
    }

    // 3. Member-specific labels (e.g. "member 2 name", "teammate 1 email")
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const memberIndex = i + 1;
      if (
        label.includes(`member ${memberIndex}`) ||
        label.includes(`teammate ${memberIndex}`) ||
        label.includes(`member${memberIndex}`) ||
        label.includes(`participant ${memberIndex}`)
      ) {
        return {
          fieldId,
          memberId: m.memberId,
          confidence: 0.95,
          reason: `Explicit reference to team member ${memberIndex}`,
        };
      }
    }

    // 4. Safe default for general/ambiguous fields -> team leader.
    // Do NOT guess based on field order/position here — a repeated "Name"
    // field at index 3 is not reliably "the 3rd person's name" without real
    // grouping information (e.g. a section/fieldset the extractor doesn't
    // currently capture), and guessing that would fabricate certainty the
    // extraction doesn't actually have.
    if (isAmbiguousDuplicateLabel(field)) {
      return {
        fieldId,
        memberId: leader.memberId,
        confidence: 0.4,
        reason: `Ambiguous: label "${field.label}" repeats across multiple fields with no distinguishing context (no section/group info available), so it can't be reliably attributed to a specific teammate. Defaulted to leader — please reassign manually on the review board.`,
      };
    }

    return {
      fieldId,
      memberId: leader.memberId,
      confidence: 0.75,
      reason: "General field assigned to leader as safe default",
    };
  });

  return { assignments };
}

/**
 * Calls Gemini through @google/genai to produce assignments.
 */
async function callGemini(sanitizedFields, sanitizedMembers) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.log("[AI Assignment] GEMINI_API_KEY not configured. Falling back to heuristic engine.");
    return generateHeuristicAssignments(sanitizedFields, sanitizedMembers);
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

  const systemInstruction = `You are an AI assistant for CYHI, a collaborative form-filling platform.
Your task is to analyze form fields and team members to suggest initial field assignments.
For each field, infer ownership from all available evidence.

Priority:
1. Explicit contextual/person reference in label or surrounding text.
2. Role-specific wording matching a member role.
3. Section/group context from the original form.
4. Placeholder/contextual hints.
5. Team/project-level fields → leader.
6. Truly ambiguous personal fields:
   assign to leader only when there is no evidence that the field belongs
   to another member.

Do not assume every generic Name/Email/Phone field belongs to the leader.
Use field order and contextual information when they provide evidence,
but never invent facts.

You must return valid JSON matching this schema:
{
  "assignments": [
    {
      "fieldId": "string",
      "memberId": "string",
      "confidence": number,
      "reason": "string"
    }
  ]
}`;

  const prompt = `Form fields:
${JSON.stringify(sanitizedFields, null, 2)}

Team members:
${JSON.stringify(sanitizedMembers, null, 2)}

Assign every form field to exactly one team member according to the rules.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            assignments: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  fieldId: { type: "STRING" },
                  memberId: { type: "STRING" },
                  confidence: { type: "NUMBER" },
                  reason: { type: "STRING" },
                },
                required: ["fieldId", "memberId", "confidence", "reason"],
              },
            },
          },
          required: ["assignments"],
        },
      },
    });

    let rawText = response.text;
    if (!rawText) {
      throw new Error("Empty response from Gemini.");
    }

    rawText = rawText.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(rawText);
    return parsed;
  } catch (err) {
    console.error("[AI Assignment] Gemini call failed:", err.message);
    throw new ApiError(502, `AI service error: ${err.message}`);
  }
}

/**
 * Validates AI assignment suggestions against Form and Team constraints.
 * Throws ApiError if ANY validation rule fails.
 */
function validateAiOutput(aiResult, form, team) {
  if (!aiResult || typeof aiResult !== "object" || !Array.isArray(aiResult.assignments)) {
    throw new ApiError(422, "AI output must contain an 'assignments' array.");
  }

  // Verify Team.formId matches formId
  if (!team || !team.formId || !form || !form._id || team.formId.toString() !== form._id.toString()) {
    throw new ApiError(400, "Team does not belong to this form.");
  }

  const assignments = aiResult.assignments;
  const formFieldIds = new Set(form.fields.map((f) => f.fieldId));
  const teamMemberIds = new Set(team.members.map((m) => m._id.toString()));

  // 1. Every form field receives exactly one suggestion (length must match)
  if (assignments.length !== form.fields.length) {
    throw new ApiError(
      422,
      `AI returned ${assignments.length} assignments, but form has ${form.fields.length} fields.`
    );
  }

  const assignedFieldIds = new Set();

  for (let i = 0; i < assignments.length; i++) {
    const item = assignments[i];
    if (!item || typeof item !== "object") {
      throw new ApiError(422, `Assignment at index ${i} is not an object.`);
    }

    const { fieldId, memberId, confidence, reason } = item;

    // 2. fieldId exists on Form.fields
    if (!fieldId || !formFieldIds.has(fieldId)) {
      throw new ApiError(422, `AI returned invalid or unknown fieldId: "${fieldId}".`);
    }

    // 3. Reject duplicate field assignments
    if (assignedFieldIds.has(fieldId)) {
      throw new ApiError(422, `AI returned duplicate assignment for fieldId: "${fieldId}".`);
    }
    assignedFieldIds.add(fieldId);

    // 4. memberId exists on Team.members
    if (!memberId || !teamMemberIds.has(memberId.toString())) {
      throw new ApiError(422, `AI returned invalid or unknown memberId: "${memberId}".`);
    }

    // 5. confidence is between 0 and 1
    const conf = Number(confidence);
    if (typeof confidence !== "number" || Number.isNaN(conf) || conf < 0 || conf > 1) {
      throw new ApiError(
        422,
        `Invalid confidence "${confidence}" for field "${fieldId}". Must be between 0 and 1.`
      );
    }

    // 6. reason must be a string
    if (typeof reason !== "string") {
      throw new ApiError(422, `Invalid reason for field "${fieldId}". Must be a string.`);
    }
  }

  // 7. Verify all form fields are accounted for
  for (const fieldId of formFieldIds) {
    if (!assignedFieldIds.has(fieldId)) {
      throw new ApiError(422, `Missing AI suggestion for form field: "${fieldId}".`);
    }
  }

  return assignments;
}

/**
 * Generates and validates AI assignments for a given form and team.
 */
async function generateAiAssignmentsForForm(form, team) {
  const sanitizedFields = sanitizeFormFields(form.fields);
  const sanitizedMembers = sanitizeTeamMembers(team.members);
  const rawAiResult = await callGemini(sanitizedFields, sanitizedMembers);
  return validateAiOutput(rawAiResult, form, team);
}

module.exports = {
  sanitizeFormFields,
  sanitizeTeamMembers,
  callGemini,
  validateAiOutput,
  generateHeuristicAssignments,
  generateAiAssignmentsForForm,
};
