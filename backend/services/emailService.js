const nodemailer = require("nodemailer");

// Google displays App Passwords with spaces for readability
// ("abcd efgh ijkl mnop"); the actual credential has none. A value pasted
// with the spaces intact, or with a trailing newline/CR from how the .env
// file was saved, is a common real-world cause of "535 BadCredentials" that
// has nothing to do with whether the password itself is valid.
function readGmailCredentials() {
  const user = (process.env.GMAIL_USER || "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  return { user, pass };
}

let transporter = null;

// Created lazily (not at module load) so a missing/misconfigured .env fails
// with a clear, specific error the first time it's actually needed, instead
// of nodemailer's generic auth error or a silent transporter with empty
// credentials.
function getTransporter() {
  if (transporter) return transporter;

  const { user, pass } = readGmailCredentials();
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER and/or GMAIL_APP_PASSWORD are not set (or are empty after trimming). " +
        "Set both in your .env — see .env.example."
    );
  }

  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user,
      pass
    }
  });
  
  return transporter;
}

const INVITATION_SUBJECT = "You've been invited to collaborate on a form Through CYHI";

function buildInvitationText(joinUrl) {
  return `
  Hi,\n

  You've been invited to contribute to a form through CYHI.

  Open your assigned fields:\n

  You can review and submit your responses there.\n
  \nOpen your form:\n${joinUrl}\n\n
  — CYHI  
  `;
}

function buildInvitationHtml(joinUrl) {
  return `<p>You have been invited to fill your part of a form.</p><p>Open your form:<br/><a href="${joinUrl}">${joinUrl}</a></p>`;
}

async function sendInvitationEmail({ to, joinUrl }) {
  const { user } = readGmailCredentials();

  console.log(`[CYHI EMAIL] Preparing invitation email`);
  console.log(`[CYHI EMAIL] Recipient: ${to}`);
  console.log(`[CYHI EMAIL] Sender: ${user}`);
  console.log(`[CYHI EMAIL] Subject: ${INVITATION_SUBJECT}`);

  const t = getTransporter(); // throws a clear config error before ever touching SMTP

  try {
    const result = await t.sendMail({
      from: user,
      to, // Correctly use the passed argument 'to'
      subject: INVITATION_SUBJECT,
      text: buildInvitationText(joinUrl),
      html: buildInvitationHtml(joinUrl)
    });

    console.log(`[CYHI EMAIL] Gmail/Nodemailer response: accepted=${result.accepted.length}, rejected=${result.rejected.length}, messageId=${result.messageId}`);
    return result;
  } catch (error) {
    console.error(`[CYHI EMAIL] Error sending email via Nodemailer: ${error.message}`);
    throw error;
  }
}

// Verifies SMTP auth WITHOUT sending a real email. Never throws — always
// resolves with { ok, error? } so callers (and the verify-gmail script) can
// distinguish "not configured / code issue" from "Gmail rejected the
// credentials" without crashing.
async function verifyTransporter() {
  try {
    const t = getTransporter();
    await t.verify();
    console.log("[CYHI EMAIL] SMTP connection verified successfully.");
    return { ok: true };
  } catch (error) {
    console.error("[CYHI EMAIL] SMTP verification failed:", error.message);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  INVITATION_SUBJECT,
  buildInvitationText,
  buildInvitationHtml,
  sendInvitationEmail,
  verifyTransporter
};
