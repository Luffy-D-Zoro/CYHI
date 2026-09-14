// Verifies Gmail SMTP configuration without sending a real email and
// without ever printing the credential itself. Run with: npm run verify:gmail
require("dotenv").config();
const emailService = require("../services/emailService");

(async () => {
  const user = (process.env.GMAIL_USER || "").trim();
  const passSet = Boolean((process.env.GMAIL_APP_PASSWORD || "").trim());

  console.log("=== CYHI Gmail SMTP verification ===");
  console.log(`GMAIL_USER set: ${user ? "yes (" + user + ")" : "no"}`);
  console.log(`GMAIL_APP_PASSWORD set: ${passSet ? "yes (redacted)" : "no"}`);

  if (!user || !passSet) {
    console.error(
      "\n✗ Missing configuration. This is a CODE/CONFIG issue: set both GMAIL_USER and " +
        "GMAIL_APP_PASSWORD in backend/.env before this can be tested."
    );
    process.exit(1);
  }

  const result = await emailService.verifyTransporter();

  if (result.ok) {
    console.log("\n✓ Gmail SMTP authentication succeeded. GMAIL_USER/GMAIL_APP_PASSWORD are valid.");
    process.exit(0);
  }

  console.error(`\n✗ Gmail SMTP authentication FAILED: ${result.error}`);
  console.error(
    "\nThis is an EXTERNAL CREDENTIAL problem, not a code bug, if the error above is an auth " +
      "rejection (e.g. \"BadCredentials\", \"Username and Password not accepted\"). It means:\n" +
      "  - GMAIL_APP_PASSWORD is not a valid, current Google App Password for GMAIL_USER, or\n" +
      "  - 2-Step Verification isn't enabled on that Google account (required to create App Passwords), or\n" +
      "  - the App Password was revoked/regenerated since it was last saved.\n" +
      "Fix: generate a fresh App Password at https://myaccount.google.com/apppasswords for the " +
      `GMAIL_USER account (${user}) and replace GMAIL_APP_PASSWORD in .env with it.`
  );
  process.exit(1);
})();
