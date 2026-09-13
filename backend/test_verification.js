const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const http = require("http");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const Form = require("./models/Form");
const Team = require("./models/Team");
const Assignment = require("./models/Assignment");
const Invitation = require("./models/Invitation");
const Response = require("./models/Response");

const BASE_URL = "http://localhost:5000";

async function request(method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runAllTests() {
  console.log("=== STARTING COMPREHENSIVE E2E VERIFICATION ===");

  // Connect to DB for direct DB assertions
  await connectDB();

  // 1 & 2: Verify server root
  console.log("\n[Test 1 & 2] Verifying server is running...");
  const rootRes = await request("GET", "/");
  if (rootRes.status !== 200 || !rootRes.data.message) {
    throw new Error(`Server root check failed: ${JSON.stringify(rootRes)}`);
  }
  console.log("✓ Server running and responding:", rootRes.data);

  // 3: Create a collaboration
  console.log("\n[Test 3] Creating a collaboration via POST /api/collaborations...");
  const collabPayload = {
    sourceUrl: "https://hackathon.example.com/apply",
    sourceType: "html",
    fields: [
      {
        fieldId: "f1",
        index: 0,
        type: "text",
        label: "Team Name",
        placeholder: "Enter team name",
        required: true,
        selectors: { id: "#team_name", name: "team_name", cssPath: "form input:nth-child(1)" },
      },
      {
        fieldId: "f2",
        index: 1,
        type: "textarea",
        label: "Project Description",
        placeholder: "Describe your project",
        required: true,
        selectors: { id: "#proj_desc", name: "proj_desc", cssPath: "form textarea:nth-child(2)" },
      },
      {
        fieldId: "f3",
        index: 2,
        type: "text",
        label: "Backend Experience & APIs",
        placeholder: "Detail your backend work",
        required: true,
        selectors: { id: "#backend_exp", name: "backend_exp", cssPath: "form input:nth-child(3)" },
      },
      {
        fieldId: "f4",
        index: 3,
        type: "text",
        label: "Frontend UI/UX Experience",
        placeholder: "Detail your UI work",
        required: false,
        selectors: { id: "#frontend_exp", name: "frontend_exp", cssPath: "form input:nth-child(4)" },
      },
    ],
    leader: {
      name: "Priya Sharma",
      email: `leader_${Date.now()}@example.com`,
      role: "team-lead",
    },
    members: [
      {
        email: `rahul_${Date.now()}@example.com`,
        role: "backend-developer",
      },
      {
        email: `aman_${Date.now()}@example.com`,
        role: "frontend-developer",
      },
    ],
  };

  const collabRes = await request("POST", "/api/collaborations", collabPayload);
  if (collabRes.status !== 201 || !collabRes.data.formId || !collabRes.data.teamId) {
    throw new Error(`Failed to create collaboration: ${JSON.stringify(collabRes)}`);
  }
  const formId = collabRes.data.formId;
  const teamId = collabRes.data.teamId;
  const members = collabRes.data.members;
  console.log(`✓ Collaboration created: formId=${formId}, teamId=${teamId}`);
  console.log(`  Members: ${members.map((m) => `${m.email} (${m.role})`).join(", ")}`);

  // 4: Confirm NO fake assignments created
  console.log("\n[Test 4] Checking for fake/round-robin placeholder assignments...");
  const initialAssignmentCount = await Assignment.countDocuments({ formId });
  if (initialAssignmentCount !== 0) {
    throw new Error(`Expected 0 assignments after collaboration creation, found ${initialAssignmentCount}`);
  }
  console.log("✓ CONFIRMED: 0 placeholder assignments created upon collaboration creation.");

  // 5 & 6: Call POST /api/forms/:formId/ai-assignments
  console.log("\n[Test 5 & 6] Calling POST /api/forms/:formId/ai-assignments...");
  const aiRes = await request("POST", `/api/forms/${formId}/ai-assignments`, { teamId });
  if (aiRes.status !== 200 || !aiRes.data.success) {
    throw new Error(`AI assignment generation failed: ${JSON.stringify(aiRes)}`);
  }
  const storedAssignments = await Assignment.find({ formId }).lean();
  if (storedAssignments.length !== 4) {
    throw new Error(`Expected 4 stored assignments, found ${storedAssignments.length}`);
  }
  for (const a of storedAssignments) {
    if (a.source !== "ai") throw new Error(`Expected source="ai", got "${a.source}"`);
    if (typeof a.confidence !== "number" || a.confidence < 0 || a.confidence > 1) {
      throw new Error(`Invalid confidence: ${a.confidence}`);
    }
    if (!a.reason) throw new Error(`Missing reason for field ${a.fieldId}`);
  }
  console.log(`✓ AI assignments successfully generated and stored:`);
  storedAssignments.forEach((a) => {
    console.log(`  - Field ${a.fieldId} -> memberId: ${a.memberId}, confidence: ${a.confidence}, reason: "${a.reason}"`);
  });

  // 7 & 8: Call GET /api/forms/:formId/assignments?teamId=...
  console.log("\n[Test 7 & 8] Calling GET /api/forms/:formId/assignments?teamId=... for review UI...");
  const reviewRes = await request("GET", `/api/forms/${formId}/assignments?teamId=${teamId}`);
  if (reviewRes.status !== 200 || !reviewRes.data.assignments || !reviewRes.data.grouped) {
    throw new Error(`Review endpoint failed: ${JSON.stringify(reviewRes)}`);
  }
  const { assignments: flatRows, grouped } = reviewRes.data;
  if (flatRows.length !== 4) {
    throw new Error(`Expected 4 flat rows, got ${flatRows.length}`);
  }
  // Check flat row structure
  const firstFlat = flatRows[0];
  const requiredFlatKeys = ["fieldId", "label", "type", "required", "memberId", "memberEmail", "memberRole", "source", "confidence", "reason", "status"];
  for (const k of requiredFlatKeys) {
    if (!(k in firstFlat)) throw new Error(`Flat row missing key: ${k}`);
  }
  // Check grouped structure
  if (grouped.length !== members.length) {
    throw new Error(`Expected ${members.length} grouped members, got ${grouped.length}`);
  }
  for (const g of grouped) {
    if (!g.memberId || !g.email || !("isLeader" in g) || !Array.isArray(g.fields)) {
      throw new Error(`Invalid grouped member format: ${JSON.stringify(g)}`);
    }
  }
  console.log("✓ Review UI data structure validated (flat rows + grouped columns):");
  grouped.forEach((g) => {
    console.log(`  * ${g.email} (${g.role}, isLeader=${g.isLeader}): ${g.fields.length} field(s) assigned`);
    g.fields.forEach((f) => console.log(`      - [${f.fieldId}] ${f.label} (${f.source})`));
  });

  // 9 & 10: PATCH one field to another member (Leader Drag & Drop)
  console.log("\n[Test 9 & 10] Testing PATCH /api/forms/:formId/assignments/:fieldId (Leader Drag/Drop)...");
  // Let's drag field f3 to member Aman
  const amanMember = members.find((m) => m.role === "frontend-developer");
  const dragRes = await request("PATCH", `/api/forms/${formId}/assignments/f3`, {
    teamId,
    memberId: amanMember.memberId,
  });
  if (dragRes.status !== 200 || !dragRes.data.success) {
    throw new Error(`Drag and drop PATCH failed: ${JSON.stringify(dragRes)}`);
  }
  const updatedF3 = await Assignment.findOne({ formId, fieldId: "f3" }).lean();
  if (updatedF3.memberId.toString() !== amanMember.memberId.toString()) {
    throw new Error(`Expected memberId ${amanMember.memberId}, got ${updatedF3.memberId}`);
  }
  if (updatedF3.source !== "leader") {
    throw new Error(`Expected source="leader", got "${updatedF3.source}"`);
  }
  if (updatedF3.confidence !== undefined && updatedF3.confidence !== null) {
    throw new Error(`Expected AI confidence to be cleared, got ${updatedF3.confidence}`);
  }
  console.log(`✓ Field f3 successfully reassigned by leader to ${amanMember.email}:`);
  console.log(`  source="${updatedF3.source}", confidence=${updatedF3.confidence}, reason="${updatedF3.reason}"`);

  // 11 & 12: Run AI assignment again -> verify leader assignment is protected
  console.log("\n[Test 11 & 12] Running AI assignment again to verify Leader Protection...");
  const aiRes2 = await request("POST", `/api/forms/${formId}/ai-assignments`, { teamId });
  if (aiRes2.status !== 200 || !aiRes2.data.success) {
    throw new Error(`Second AI assignment call failed: ${JSON.stringify(aiRes2)}`);
  }
  if (!aiRes2.data.protectedFields.includes("f3")) {
    throw new Error(`Expected "f3" to be in protectedFields, got: ${JSON.stringify(aiRes2.data.protectedFields)}`);
  }
  const postAiF3 = await Assignment.findOne({ formId, fieldId: "f3" }).lean();
  if (postAiF3.memberId.toString() !== amanMember.memberId.toString()) {
    throw new Error(`LEADER ASSIGNMENT OVERWRITTEN! Expected ${amanMember.memberId}, got ${postAiF3.memberId}`);
  }
  if (postAiF3.source !== "leader") {
    throw new Error(`Expected source="leader", got "${postAiF3.source}"`);
  }
  console.log("✓ CONFIRMED: Leader assignment f3 remained untouched and protected!");
  console.log(`  Protected fields returned: ${JSON.stringify(aiRes2.data.protectedFields)}`);

  // 13: Verify invalid fieldId is rejected
  console.log("\n[Test 13] Verifying invalid fieldId is rejected with 404...");
  const badFieldRes = await request("PATCH", `/api/forms/${formId}/assignments/non_existent_field`, {
    teamId,
    memberId: amanMember.memberId,
  });
  if (badFieldRes.status !== 404) {
    throw new Error(`Expected 404 for invalid fieldId, got ${badFieldRes.status}`);
  }
  console.log("✓ Invalid fieldId correctly rejected with 404.");

  // 14: Verify invalid memberId is rejected
  console.log("\n[Test 14] Verifying invalid memberId is rejected with 400...");
  const fakeMemberId = new mongoose.Types.ObjectId().toString();
  const badMemberRes = await request("PATCH", `/api/forms/${formId}/assignments/f1`, {
    teamId,
    memberId: fakeMemberId,
  });
  if (badMemberRes.status !== 400) {
    throw new Error(`Expected 400 for invalid memberId, got ${badMemberRes.status}`);
  }
  console.log("✓ Invalid memberId correctly rejected with 400.");

  // 15: Verify team belonging to another form is rejected
  console.log("\n[Test 15] Verifying mismatched team/form is rejected with 400...");
  const otherForm = await Form.create({
    sourceUrl: "https://other.example.com",
    fields: [
      { fieldId: "other_f1", index: 0, type: "text", label: "Other", selectors: {} },
    ],
  });
  const mismatchRes = await request("POST", `/api/forms/${otherForm._id}/ai-assignments`, { teamId });
  if (mismatchRes.status !== 400) {
    throw new Error(`Expected 400 for mismatched team/form, got ${mismatchRes.status}`);
  }
  console.log("✓ Mismatched team and form correctly rejected with 400.");

  // 16: Confirm existing invitation records still work
  console.log("\n[Test 16] Confirming existing invitation records still work (GET /api/join/:token)...");
  const invitation = await Invitation.findOne({ formId, memberId: amanMember.memberId }).lean();
  if (!invitation) throw new Error("Invitation record not found for Aman");
  const joinRes = await request("GET", `/api/join/${invitation.token}`);
  if (joinRes.status !== 200 || !joinRes.data.fields) {
    throw new Error(`Failed to resolve invitation: ${JSON.stringify(joinRes)}`);
  }
  // Aman was assigned f3
  const amanAssignedFieldIds = joinRes.data.fields.map((f) => f.fieldId);
  if (!amanAssignedFieldIds.includes("f3")) {
    throw new Error(`Expected Aman to see assigned field f3, got: ${JSON.stringify(amanAssignedFieldIds)}`);
  }
  console.log(`✓ Invitation token resolved: Aman received fields: ${JSON.stringify(amanAssignedFieldIds)}`);

  // 17: Confirm existing email sending still works (or route responds correctly)
  console.log("\n[Test 17] Confirming invitation sending endpoint POST /api/collaborations/:teamId/invitations/send...");
  const sendRes = await request("POST", `/api/collaborations/${teamId}/invitations/send`);
  if (sendRes.status !== 200) {
    throw new Error(`Invitation sending route failed with status ${sendRes.status}: ${JSON.stringify(sendRes)}`);
  }
  console.log(`✓ Email sending endpoint responded successfully:`, sendRes.data);

  // Optional endpoint test: PUT /api/forms/:formId/assignments/review (bulk update)
  console.log("\n[Optional Endpoint Test] Testing PUT /api/forms/:formId/assignments/review (Bulk Review)...");
  const bulkRes = await request("PUT", `/api/forms/${formId}/assignments/review`, {
    teamId,
    assignments: [
      { fieldId: "f1", memberId: amanMember.memberId },
      { fieldId: "f2", memberId: amanMember.memberId },
    ],
  });
  if (bulkRes.status !== 200 || !bulkRes.data.success) {
    throw new Error(`Bulk review failed: ${JSON.stringify(bulkRes)}`);
  }
  console.log(`✓ Bulk review updated ${bulkRes.data.updatedCount} fields to source="leader".`);

  // [Test 18] Unit testing AI output validation edge cases
  console.log("\n[Test 18] Testing AI output validation edge cases...");
  const { validateAiOutput } = require("./services/aiService");
  const sampleForm = {
    _id: new mongoose.Types.ObjectId(),
    fields: [
      { fieldId: "f_alpha", type: "text" },
      { fieldId: "f_beta", type: "text" },
    ],
  };
  const memberA = new mongoose.Types.ObjectId();
  const memberB = new mongoose.Types.ObjectId();
  const sampleTeam = {
    _id: new mongoose.Types.ObjectId(),
    formId: sampleForm._id,
    members: [
      { _id: memberA, email: "a@example.com", role: "backend" },
      { _id: memberB, email: "b@example.com", role: "frontend" },
    ],
  };

  // Case 1: Confidence out of bounds
  try {
    validateAiOutput(
      {
        assignments: [
          { fieldId: "f_alpha", memberId: memberA.toString(), confidence: 1.5, reason: "test" },
          { fieldId: "f_beta", memberId: memberB.toString(), confidence: 0.5, reason: "test" },
        ],
      },
      sampleForm,
      sampleTeam
    );
    throw new Error("Validation should have failed for confidence > 1");
  } catch (err) {
    if (err.statusCode !== 422) throw err;
    console.log("  ✓ Rejected confidence > 1 (HTTP 422)");
  }

  // Case 2: Duplicate field assignment
  try {
    validateAiOutput(
      {
        assignments: [
          { fieldId: "f_alpha", memberId: memberA.toString(), confidence: 0.9, reason: "test" },
          { fieldId: "f_alpha", memberId: memberB.toString(), confidence: 0.8, reason: "test" },
        ],
      },
      sampleForm,
      sampleTeam
    );
    throw new Error("Validation should have failed for duplicate fieldId");
  } catch (err) {
    if (err.statusCode !== 422) throw err;
    console.log("  ✓ Rejected duplicate field assignment (HTTP 422)");
  }

  // Case 3: Unknown fieldId
  try {
    validateAiOutput(
      {
        assignments: [
          { fieldId: "unknown_field", memberId: memberA.toString(), confidence: 0.9, reason: "test" },
          { fieldId: "f_beta", memberId: memberB.toString(), confidence: 0.8, reason: "test" },
        ],
      },
      sampleForm,
      sampleTeam
    );
    throw new Error("Validation should have failed for unknown fieldId");
  } catch (err) {
    if (err.statusCode !== 422) throw err;
    console.log("  ✓ Rejected unknown fieldId (HTTP 422)");
  }

  // Case 4: Unknown memberId
  try {
    validateAiOutput(
      {
        assignments: [
          { fieldId: "f_alpha", memberId: new mongoose.Types.ObjectId().toString(), confidence: 0.9, reason: "test" },
          { fieldId: "f_beta", memberId: memberB.toString(), confidence: 0.8, reason: "test" },
        ],
      },
      sampleForm,
      sampleTeam
    );
    throw new Error("Validation should have failed for unknown memberId");
  } catch (err) {
    if (err.statusCode !== 422) throw err;
    console.log("  ✓ Rejected unknown memberId (HTTP 422)");
  }

  // Case 5: Missing form field
  try {
    validateAiOutput(
      {
        assignments: [
          { fieldId: "f_alpha", memberId: memberA.toString(), confidence: 0.9, reason: "test" },
        ],
      },
      sampleForm,
      sampleTeam
    );
    throw new Error("Validation should have failed for missing form field");
  } catch (err) {
    if (err.statusCode !== 422) throw err;
    console.log("  ✓ Rejected incomplete assignments count (HTTP 422)");
  }

  // ================= NEW: Member response persistence (Section D/E/F) =================
  // Tests 1-18 above never actually exercised POST /api/join/:token with a
  // response body, so the persistence path was untested. These fill that gap.

  console.log("\n[Test 19] Member submits responses -> verify Response docs actually exist in MongoDB...");
  // Aman (from Test 16) is assigned f3 only, per that invitation lookup.
  const amanInvite = await Invitation.findOne({ formId, memberId: amanMember.memberId }).lean();
  const submitRes = await request("POST", `/api/join/${amanInvite.token}`, {
    responses: [{ fieldId: "f3", value: "Node.js + Express + MongoDB" }],
  });
  if (submitRes.status !== 200 || !submitRes.data.success) {
    throw new Error(`Member submission failed: ${JSON.stringify(submitRes)}`);
  }
  const savedResponse = await Response.findOne({
    formId,
    fieldId: "f3",
    memberId: amanMember.memberId,
  }).lean();
  if (!savedResponse || savedResponse.value !== "Node.js + Express + MongoDB") {
    throw new Error(
      `Response document was not actually persisted in MongoDB: ${JSON.stringify(savedResponse)}`
    );
  }
  console.log("  ✓ Response document found directly in MongoDB:", {
    formId: savedResponse.formId.toString(),
    fieldId: savedResponse.fieldId,
    memberId: savedResponse.memberId.toString(),
    value: savedResponse.value,
  });

  console.log("\n[Test 20] Resubmitting the same field updates the existing Response instead of duplicating it...");
  const beforeCount = await Response.countDocuments({ formId, fieldId: "f3", memberId: amanMember.memberId });
  const resubmitRes = await request("POST", `/api/join/${amanInvite.token}`, {
    responses: [{ fieldId: "f3", value: "Node.js + Express + MongoDB + Redis" }],
  });
  if (resubmitRes.status !== 200 || !resubmitRes.data.success) {
    throw new Error(`Resubmission failed: ${JSON.stringify(resubmitRes)}`);
  }
  const afterCount = await Response.countDocuments({ formId, fieldId: "f3", memberId: amanMember.memberId });
  if (afterCount !== 1 || beforeCount !== 1) {
    throw new Error(`Expected exactly 1 Response document before/after resubmit, got before=${beforeCount} after=${afterCount}`);
  }
  const updated = await Response.findOne({ formId, fieldId: "f3", memberId: amanMember.memberId }).lean();
  if (updated.value !== "Node.js + Express + MongoDB + Redis") {
    throw new Error(`Resubmit did not update the value, got: ${updated.value}`);
  }
  console.log("  ✓ Existing Response document updated in place (no duplicate created).");

  console.log("\n[Test 21] A batch containing an unauthorized fieldId writes NOTHING (no partial writes)...");
  // "totally_unassigned_field" doesn't exist on this form/assignment set at
  // all, so it's guaranteed to fail the ownership check regardless of how
  // earlier tests reassigned f1/f2/f4 — this isolates the batch-validation
  // behavior itself rather than depending on assignment history.
  const beforeAny = await Response.find({ formId, memberId: amanMember.memberId }).lean();
  const badBatchRes = await request("POST", `/api/join/${amanInvite.token}`, {
    responses: [
      { fieldId: "f3", value: "This value should NOT be persisted" },
      { fieldId: "totally_unassigned_field", value: "Not assigned to Aman at all" },
    ],
  });
  if (badBatchRes.status < 400) {
    throw new Error(`Expected the invalid batch to be rejected, got status ${badBatchRes.status}`);
  }
  const afterAny = await Response.find({ formId, memberId: amanMember.memberId }).lean();
  const f3Doc = afterAny.find((r) => r.fieldId === "f3");
  if (!f3Doc || f3Doc.value !== "Node.js + Express + MongoDB + Redis") {
    throw new Error(
      `Invalid batch caused a partial write — f3's value changed even though the batch was rejected: ${JSON.stringify(f3Doc)}`
    );
  }
  if (afterAny.some((r) => r.fieldId === "totally_unassigned_field")) {
    throw new Error("Invalid batch caused a partial write — an unauthorized field was persisted.");
  }
  if (afterAny.length !== beforeAny.length) {
    throw new Error("Invalid batch changed the number of Response documents for Aman — partial write occurred.");
  }
  console.log(`  ✓ Rejected with status ${badBatchRes.status} and left MongoDB completely unchanged (${afterAny.length} doc(s), same as before).`);

  console.log("\n[Test 22] Final aggregation reads the persisted Response value (not a second store)...");
  const finalRes = await request("GET", `/api/forms/${formId}/final`);
  if (finalRes.status !== 200) {
    throw new Error(`Final aggregation failed: ${JSON.stringify(finalRes)}`);
  }
  if (finalRes.data.finalValues.f3 !== "Node.js + Express + MongoDB + Redis") {
    throw new Error(
      `Final aggregation did not reflect the persisted MongoDB value for f3: ${JSON.stringify(finalRes.data.finalValues)}`
    );
  }
  console.log("  ✓ /api/forms/:formId/final returned the exact value stored in the Response collection for f3.");

  console.log("\n=======================================================");
  console.log("ALL VERIFICATION CHECKS (1-22) PASSED SUCCESSFULLY! 🎉");
  console.log("=======================================================");

  process.exit(0);
}

runAllTests().catch((err) => {
  console.error("\n❌ VERIFICATION TEST FAILED:", err);
  process.exit(1);
});
