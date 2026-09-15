# CYHI — Collaborative Form Workspace

> **One request. Many contributors. One final submission.**

CYHI turns a normal web form into a collaborative workspace. A leader opens a form through the Chrome extension, adds teammates by email and role, lets AI propose field ownership, reviews the assignments, and sends each teammate a focused link containing only their fields. Completed responses are collected centrally and can be pushed back into the original form for final review and submission.

## The important part: CYHI starts from the Chrome extension

CYHI is **not** a project where users are expected to open the backend or React app first.

The normal user flow is:

```text
Open a form
    ↓
Open CYHI Chrome extension
    ↓
Add teammates (email + role)
    ↓
Create collaboration
    ↓
Review AI field assignments
    ↓
Send invitations
    ↓
Teammates fill only their assigned fields
    ↓
Leader gets the collected responses
    ↓
CYHI fills the original form for final review
```

The backend and frontend are already deployed, so a normal user does **not** need Node.js, MongoDB, Vite, or a local server just to try CYHI.

---

## Quick start — use the deployed version

### 1. Install the extension

Until the Chrome Web Store release is available, use Chrome's **Load unpacked** flow.

### Install CYHI

1. **Download the extension**  
   [Download CYHI Extension](https://github.com/Luffy-D-Zoro/CYHI/releases/latest)

2. **Extract the ZIP**  
   Extract `cyhi-extension.zip` to any folder.

3. **Open Chrome Extensions**  
   Go to:
   `chrome://extensions`

4. **Enable Developer mode**  
   Turn on **Developer mode** in the top-right corner.

5. **Load CYHI**  
   Click **Load unpacked** and select the extracted folder containing `manifest.json`.

6. **Start using CYHI**  
   Open a web form, click the CYHI extension, and create your collaboration.

> A Chrome Web Store version is planned. Until then, CYHI is installed using Chrome's **Load unpacked** option.

> This is the only setup a normal user needs for the current deployed demo.

### 2. Use CYHI

1. Open the web form you want to collaborate on.
2. Click the CYHI extension.
3. Enter your leader details if CYHI cannot detect your Chrome profile email.
4. Add each teammate using their **email + role**.
5. Create the collaboration.
6. Review the AI-generated field assignments and adjust them if necessary.
7. Send invitations.
8. Each teammate opens their invitation and submits their assigned fields.
9. Return to the original form and use CYHI's **Fill with collected responses** action.
10. Review the filled form yourself and submit the original form manually.

### No local backend/frontend setup is required for this flow

The current extension is configured to use the deployed CYHI services:

- Frontend: `https://cyhi-rho.vercel.app`
- Backend: `https://cyhi-production.up.railway.app`

---

## What CYHI solves

Group forms often have one person collecting answers from everyone and manually transferring them into the final form. That creates unnecessary coordination and copy/paste errors.

CYHI changes the workflow to:

```text
One leader
   → one collaboration
   → many focused member tasks
   → one collected response set
   → one final form
```

Instead of asking everyone to edit the same form, CYHI gives each contributor only the fields they are responsible for.

---

## How it works

### 1. Form extraction

The extension reads the active form and records useful field metadata and selectors.

### 2. Collaboration creation

The backend creates the form, team, and invitations in MongoDB.

### 3. AI assignment

The backend sends the normalized fields and team roles to the AI assignment service. The result is validated so each field has an ownership decision.

### 4. Human review

The leader sees the proposed assignments and can drag fields between members. Leader changes are persisted separately from AI decisions.

### 5. Member responses

Each invitation contains a unique token. A member only sees and submits the fields assigned to them.

### 6. Final aggregation

Responses are stored centrally and aggregated into the final field/value set.

### 7. Original-form filling

The extension maps the collected values back to the original form using the selectors captured during extraction. CYHI intentionally leaves final submission to the leader.

---

## Architecture

```text
┌──────────────────────┐
│   Chrome Extension   │
│                      │
│  popup.js            │
│  content.js          │
│  form extraction     │
│  final form filling  │
└──────────┬───────────┘
           │ HTTPS
           ▼
┌──────────────────────┐
│   Express Backend    │
│      Railway         │
│                      │
│ collaborations      │
│ assignments         │
│ invitations         │
│ responses            │
│ AI assignment       │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
 MongoDB       Gemini
  Atlas          AI

           ▲
           │ HTTPS
           │
┌──────────┴───────────┐
│   React Frontend     │
│       Vercel         │
│                      │
│ Leader review        │
│ Member form          │
└──────────────────────┘
```

---

## Repository structure

```text
CYHI/
├── extension/       # Chrome extension — primary user entry point
├── frontend/        # React leader/member UI
├── backend/         # Express API + MongoDB + AI/email services
└── README.md
```

The extension has **no build step**. It is a plain Manifest V3 extension.

---

## Developer setup

The quick-start section above is for users. Contributors who want to run CYHI locally need the three parts separately.

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Set the required values in `backend/.env`:

```env
PORT=5000
MONGODB_URI=...
FRONTEND_BASE_URL=http://localhost:5173
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
GMAIL_USER=...
GMAIL_APP_PASSWORD=...
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

If the frontend needs to talk to a local backend, configure `VITE_API_BASE_URL` in the frontend environment.

### Extension

Load `extension/` using:

```text
chrome://extensions → Developer mode → Load unpacked
```

For local development, point the extension constants in `extension/popup.js` to your local backend/frontend URLs.

For the public deployed demo, use the production URLs shown in the Quick Start section.

---

## Important deployment notes

### Frontend routing

CYHI uses React Router paths such as:

```text
/review/:formId
/join/:token
```

The Vercel deployment therefore needs the SPA rewrite so direct navigation to these routes serves `index.html` and lets React Router resolve the route.

`frontend/vercel.json`:

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### Frontend root route

Do not leave the development-only `mock-token-123` redirect in the production `App.jsx`. The `/` route should be a normal landing/status page rather than redirecting users to a fake invitation.

### Production URLs

The extension's production configuration should point to:

```text
API_BASE_URL      = https://cyhi-production.up.railway.app
FRONTEND_BASE_URL = https://cyhi-rho.vercel.app
```

Do not commit private backend secrets to GitHub.

---

## Current limitations

- The Chrome extension is currently installed through **Load unpacked**; the Chrome Web Store version is planned.
- Final submission of the original external form is intentionally manual so the leader can review the completed form before submitting.
- Email delivery depends on the configured mail provider and its authentication/security policies.
- AI assignments are suggestions; the leader can always correct them.

---

## Why the extension is the main entry point

CYHI is designed as a browser workflow rather than a standalone form website.

The user already has a form open in the browser. The extension is the bridge between that existing form and the collaborative workspace:

```text
Existing form
     │
     └── CYHI extension
              │
              ├── extract
              ├── collaborate
              ├── assign
              ├── collect
              └── fill back
```

That is why the extension is intentionally the first thing a new user should install.

---

## Roadmap

- Chrome Web Store distribution
- Better support for more form types and complex inputs
- Stronger AI assignment context for repeated/generic fields
- More robust response/fill handling
- Improved email delivery infrastructure
- Collaboration history and reusable teams

---

## Project

**CYHI — Collaborative Form Workspace**

**Motto:** *One request. Many contributors. One final submission.*
