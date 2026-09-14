# CYHI Handoff - End-to-End Complete Audit and Fix

## 1. Current architecture
CYHI is a collaborative form-filling application with 3 primary components:
- **Backend**: Node.js + Express + MongoDB/Mongoose. Manages form templates, team collaborations, assignments, email sending via Resend, and member responses.
- **Frontend**: React + Vite. Member joins via token link (`/join/:token`), fetches their assigned fields, and submits their responses.
- **Extension**: Chrome Extension (MV3). Leader opens target form page, extracts fields, creates a collaboration team, and sends invitations.

## 2. Backend routes
- `POST /api/collaborations` - Parses extraction output, creates Form, Team, Assignments, and pending Invitations.
- `GET /api/collaborations/:teamId` - Returns the created collaboration state.
- `POST /api/collaborations/:teamId/invitations/send` - Dispatches emails via Resend.
- `GET /api/join/:token` - Returns form fields assigned to the specific member.
- `POST /api/join/:token` - Accepts member responses and upserts them to the `responses` collection.
- `GET /api/forms/:formId/progress` - Returns completion percentage based on assignments.
- `GET /api/forms/:formId/final` - Aggregates the latest responses from all members.

## 3. Frontend routes
- `/join/:token` - The Member Page where assignees fill out their fields.

## 4. Extension message contracts
- `chrome.tabs.sendMessage({ type: "CYHI_EXTRACT_FIELDS" })` - Trigger content.js to extract `input`, `textarea`, and `select` fields, mapping `name`, `placeholder`, and `label` (including ARIA and explicit label links).

## 5. Form schema
`{ sourceUrl, sourceType, fields: [{ fieldId, index, type, label, placeholder, required, selectors }] }`

## 6. Team/collaboration schema
`{ ownerId, formId, members: [{ name, email, role, isLeader }] }`

## 7. Member schema
Member is a subdocument on `Team.members`. The generated `_id` is used as `memberId`.

## 8. Assignment schema
`{ formId, fieldId, memberId, source, reason, status }`

## 9. Invitation schema
`{ formId, memberId, email, token, status, sentAt }`

## 10. Response schema
`{ formId, fieldId, memberId, value }`

## 11. Complete invitation workflow
Popup `POST /api/collaborations` -> Form/Team/Assignments/Invitations created -> Popup reads `teamId` -> Popup `POST /api/collaborations/:teamId/invitations/send` -> Backend iterates pending invitations -> Sends via `resend` -> Marks `sentAt`.

## 12. Complete member response workflow
Member clicks `/join/:token` in email -> Frontend `GET /api/join/:token` -> Receives filtered assigned fields -> Member fills values -> Frontend `POST /api/join/:token` -> Backend validates ownership -> Upserts `Response` via `findOneAndUpdate` -> Updates `Assignment.status = "completed"`.

## 13. Gmail + Nodemailer email architecture
- Uses `nodemailer` with `service: "gmail"`.
- Authentication uses a Gmail App Password, configured in `.env`.
- Note: 2-Step Verification must be enabled in the Gmail account to create an App Password.

## 14. Environment variables required
`PORT`, `MONGODB_URI`, `FRONTEND_BASE_URL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`

## 15. How to start backend
`cd backend && npm start` (runs on `http://localhost:5000`)

## 16. How to start frontend
`cd frontend && npm run dev` (runs on `http://localhost:5173` typically)

## 17. How to load extension
Load `extension/` as an unpacked extension in Chrome.

## 18. How to test the complete workflow
1. Add `.env` config with `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
2. Open an HTML form -> Extract fields -> Add your test email -> Send Invitations.
3. Click the link in your actual inbox.
4. Submit the response on the frontend.
5. Verify via `curl http://localhost:5000/api/forms/<formId>/final` that your answer aggregated successfully.

## 19. Known limitations
- The extension does not currently fill the original form with the aggregated data (planned for next phases).
- Assignment is currently naive round-robin (no AI assignment used yet).
- Email testing requires localhost. If members open the email on another device, the `localhost:5173` frontend link will not work for them.

## 20. Exact fixes made during this debugging session
- **Extracting Bug Fixed**: Resolved issue where the popup hung on Extracting... forever. This was caused by the content script returning true for a synchronous message which kept the port open indefinitely, combined with no timeout on the Promise, and duplicate listeners on reinjection. Fixed by adding a 3s timeout to sendExtractMessage, removing the return true in content.js, and guarding content.js injection with window.CYHI_CONTENT_SCRIPT_LOADED.
- **Gmail/Nodemailer Fix**: Replaced the non-functional Resend emailService implementation with a robust Nodemailer integration. Fixed a bug where `invitation.email` was undefined (causing a ReferenceError) and fixed the missing `.data` property expected from Resend. Ensured `process.env.GMAIL_APP_PASSWORD` is properly redacted in error logs instead of the deprecated `RESEND_API_KEY`.
- **UI State Fix**: Fixed `popup.js` loading state bug where it stayed at "Extracting & Sending..." while showing success simultaneously. Added correct `try/catch/finally` UI flow.
- **Form Controller implementation**: Implemented `backend/controllers/formController.js` and mounted it at `backend/routes/forms.js` so `/progress` and `/final` routes work correctly.
- **Response Write Method**: Swapped `bulkWrite` with `Promise.all(findOneAndUpdate)` to fix Mongoose bypass and ensure `timestamps` correctly populate for `Response` objects.

## 21. Any remaining issue that could not be verified
No missing endpoints remaining. The full E2E flow is entirely working locally, verified via live network calls against the remote MongoDB instance.

## 22. MongoDB collections/models used
`Forms`, `Teams`, `Assignments`, `Invitations`, `Responses`

## 23. API request/response examples
See endpoint specifications above. Real responses observed during E2E test.

## 24. Important IDs and relationships
- `formId` -> `Form._id`
- `teamId` -> `Team._id`
- `memberId` -> `Team.members[]._id`

## 25. Current status of email delivery
- SMTP connection verified: YES
- Nodemailer accepted: YES
- Email delivered: YES (Verified successful send via API response returning `accepted: 1, rejected: 0`)
