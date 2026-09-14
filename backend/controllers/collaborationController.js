const mongoose = require("mongoose");
const Form = require("../models/Form");
const Team = require("../models/Team");
const Invitation = require("../models/Invitation");
const ApiError = require("../utils/ApiError");
const validateCollaborationInput = require("../utils/validateCollaborationInput");
const emailService = require("../services/emailService");
const nodemailer = require("nodemailer");



function buildJoinUrl(token) {
  const base = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
  return `${base.replace(/\/+$/, "")}/join/${token}`;
}

// Builds the Team.members array: the leader plus every other member, with the
// leader's subdocument _id pre-generated so it can double as Team.ownerId.
function buildTeamMembers(leader, members) {
  const leaderId = new mongoose.Types.ObjectId();
  return [
    { _id: leaderId, name: leader.name, email: leader.email, role: leader.role, isLeader: true },
    ...members.map((m) => ({
      name: typeof m.name === "string" ? m.name : "",
      email: m.email,
      role: m.role,
      isLeader: false,
    })),
  ];
}

// Creates Form -> Team -> Invitations inside an active session/transaction.
// Every operation must use `session`, or MongoDB won't include it in the
// transaction and a later abort wouldn't undo it.
async function buildCollaborationDocs(data, session) {
  const [form] = await Form.create(
    [{ sourceUrl: data.sourceUrl, sourceType: data.sourceType, fields: data.fields }],
    { session, ordered: true }
  );

  const teamMembers = buildTeamMembers(data.leader, data.members);
  const leaderMember = teamMembers.find((m) => m.isLeader);

  const [team] = await Team.create(
    [{ formId: form._id, ownerId: leaderMember._id, members: teamMembers }],
    { session, ordered: true }
  );

  const nonLeaderMembers = team.members.filter((m) => !m.isLeader);
  let invitations = [];

  if (nonLeaderMembers.length) {
    invitations = await Invitation.create(
      nonLeaderMembers.map((m) => ({
        formId: form._id,
        memberId: m._id,
        email: m.email,
        status: "pending",
      })),
      { session, ordered: true }
    );
  }

  return { form, team, invitations };
}

// Same creation sequence, but for a MongoDB deployment that doesn't support
// multi-document transactions (e.g. a standalone dev instance, not a replica
// set). Since there's no real transaction to abort, we track what we've
// created and manually delete it if a later step fails.
async function buildCollaborationDocsManual(data) {
  let form = null;
  let team = null;
  let invitations = [];

  try {
    [form] = await Form.create([
      { sourceUrl: data.sourceUrl, sourceType: data.sourceType, fields: data.fields },
    ]);

    const teamMembers = buildTeamMembers(data.leader, data.members);
    const leaderMember = teamMembers.find((m) => m.isLeader);

    [team] = await Team.create([{ formId: form._id, ownerId: leaderMember._id, members: teamMembers }]);

    const nonLeaderMembers = team.members.filter((m) => !m.isLeader);
    if (nonLeaderMembers.length) {
      invitations = await Invitation.create(
        nonLeaderMembers.map((m) => ({
          formId: form._id,
          memberId: m._id,
          email: m.email,
          status: "pending",
        }))
      );
    }

    return { form, team, invitations };
  } catch (err) {
    await Promise.allSettled(
      [
        invitations.length && Invitation.deleteMany({ _id: { $in: invitations.map((i) => i._id) } }),
        team && Team.deleteOne({ _id: team._id }),
        form && Form.deleteOne({ _id: form._id }),
      ].filter(Boolean)
    );
    throw err;
  }
}

function isTransactionsUnsupportedError(err) {
  if (!err) return false;
  const message = String(err.message || "");
  return (
    err.code === 20 ||
    err.codeName === "IllegalOperation" ||
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(message) ||
    /Transactions are not supported/i.test(message)
  );
}

function formatCollaborationResponse({ form, team, invitations }) {
  return {
    formId: form._id,
    teamId: team._id,
    members: team.members.map((m) => ({
      memberId: m._id,
      name: typeof m.name === "string" ? m.name : "",
      email: m.email,
      role: m.role,
      isLeader: m.isLeader,
    })),
    invitations: invitations.map((inv) => ({
      email: inv.email,
      token: inv.token,
      joinUrl: buildJoinUrl(inv.token),
    })),
  };
}

async function createCollaboration(req, res, next) {
  let session;
  try {
    const data = validateCollaborationInput(req.body);

    session = await mongoose.startSession();
    let created;

    try {
      await session.withTransaction(async () => {
        created = await buildCollaborationDocs(data, session);
      });
    } catch (err) {
      if (!isTransactionsUnsupportedError(err)) throw err;
      // This MongoDB deployment doesn't support transactions (no replica
      // set) — fall back to sequential creation with a manual compensating
      // rollback so Form/Team/Invitations still behave as one logical op.
      created = await buildCollaborationDocsManual(data);
    }

    res.status(201).json(formatCollaborationResponse(created));
  } catch (err) {
    next(err);
  } finally {
    if (session) await session.endSession();
  }
}

async function getCollaboration(req, res, next) {
  try {
    const { teamId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      throw new ApiError(400, `Invalid teamId: "${teamId}".`);
    }

    const team = await Team.findById(teamId).lean();
    if (!team) throw new ApiError(404, "Collaboration not found.");

    const form = await Form.findById(team.formId).lean();
    if (!form) throw new ApiError(404, "Form not found for this collaboration.");

    const invitations = await Invitation.find({ formId: team.formId }).lean();

    res.json({
      formId: form._id,
      teamId: team._id,
      form: {
        sourceUrl: form.sourceUrl,
        sourceType: form.sourceType,
        fields: form.fields,
      },
      members: team.members.map((m) => ({
        memberId: m._id,
        name: typeof m.name === "string" ? m.name : "",
        email: m.email,
        role: m.role,
        isLeader: m.isLeader,
      })),
      invitations: invitations.map((inv) => ({
        memberId: inv.memberId,
        email: inv.email,
        status: inv.status,
        joinUrl: buildJoinUrl(inv.token),
      })),
    });
  } catch (err) {
    next(err);
  }
}

function sanitizeErrorMessage(msg) {
  if (!msg) return "Failed to send email.";
  let cleaned = String(msg);
  const apiKey = process.env.GMAIL_APP_PASSWORD;
  if (apiKey && apiKey.trim()) {
    cleaned = cleaned.replaceAll(apiKey.trim(), "[REDACTED]");
  }
  return cleaned;
}

async function sendInvitations(req, res, next) {
  try {
    const { teamId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      throw new ApiError(400, `Invalid teamId: "${teamId}".`);
    }

    const team = await Team.findById(teamId);
    if (!team) {
      throw new ApiError(404, "Collaboration not found.");
    }

    const form = await Form.findById(team.formId);
    if (!form) {
      throw new ApiError(404, "Form not found for this collaboration.");
    }

    const pendingInvitations = await Invitation.find({
      formId: team.formId,
      status: "pending",
      sentAt: null,
    });

    if (pendingInvitations.length === 0) {
      return res.status(200).json({
        message: "No pending invitations to send.",
        total: 0,
        sent: 0,
        failed: 0,
        results: [],
      });
    }

    

    let sent = 0;
    let failed = 0;
    const results = [];

    for (const invitation of pendingInvitations) {
      const joinUrl = buildJoinUrl(invitation.token);
      try {
        await emailService.sendInvitationEmail({
          to: invitation.email,
          joinUrl,
        });

        invitation.sentAt = new Date();
        await invitation.save();

        sent++;
        results.push({
          email: invitation.email,
          status: "sent",
        });
      } catch (err) {
        failed++;
        results.push({
          email: invitation.email,
          status: "failed",
          error: sanitizeErrorMessage(err.message),
        });
      }
    }

    return res.status(200).json({
      message: "Invitations processed.",
      total: pendingInvitations.length,
      sent,
      failed,
      results,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCollaboration, getCollaboration, sendInvitations };

