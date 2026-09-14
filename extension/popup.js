// Backend/frontend URLs. Change these for a deployed environment (e.g.
// Railway backend URL / deployed frontend URL) — this is a plain,
// unbundled Manifest V3 extension with no build step, so there's no
// import.meta.env here; these two constants are the single place to edit.
const API_BASE_URL = "https://cyhi-production.up.railway.app";
const FRONTEND_BASE_URL = "https://cyhi-rho.vercel.app";

let members = [];

// The leader's email/name as detected from the signed-in Chrome profile via
// chrome.identity.getProfileUserInfo(). This is real browser identity, not a
// fake auth system: no OAuth flow, no invented account. If it's unavailable
// (user not signed into Chrome, or restricted by enterprise policy), we fall
// back to asking for the leader's email manually — name stays optional
// either way, since Team.members[].name already defaults to "" in the
// backend schema.
let detectedLeader = null;

// chrome.storage.local key for "this exact page already has a CYHI
// collaboration" lookups. Keyed by the extracted sourceUrl so re-opening the
// popup on the same original form can offer to fill it instead of starting
// a new collaboration. This is purely extension-side bookkeeping (formId +
// field selectors) — it never stores response values; MongoDB stays the
// only source of truth for those (see GET /api/forms/:formId/final).
function storageKeyForUrl(url) {
  return `cyhi_collab::${url}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const leaderNameInput = document.getElementById('leader-name-input');
  const leaderRoleInput = document.getElementById('leader-role-input');
  const leaderEmailInput = document.getElementById('leader-email-input');
  const leaderError = document.getElementById('leader-error');
  const leaderDetected = document.getElementById('leader-detected');
  const leaderManualFields = document.getElementById('leader-manual-fields');
  const roleInput = document.getElementById('role-input');
  const emailInput = document.getElementById('email-input');
  const addBtn = document.getElementById('add-member-btn');
  const membersList = document.getElementById('members-list');
  const emptyState = document.getElementById('empty-state');
  const sendBtn = document.getElementById('send-invites-btn');
  const emailError = document.getElementById('email-error');
  const statusMessage = document.getElementById('status-message');
  const fillSection = document.getElementById('fill-section');
  const fillFormBtn = document.getElementById('fill-form-btn');
  const fillResult = document.getElementById('fill-result');
  const startNewBtn = document.getElementById('start-new-btn');
  const leaderSection = document.getElementById('leader-section');

  function renderMembers() {
    // Clear list except empty state
    const items = membersList.querySelectorAll('.member-item');
    items.forEach(item => item.remove());

    if (members.length === 0) {
      emptyState.classList.remove('hidden');
      sendBtn.disabled = true;
    } else {
      emptyState.classList.add('hidden');
      sendBtn.disabled = false;

      members.forEach((member, index) => {
        const div = document.createElement('div');
        div.className = 'member-item bg-white border border-gray-200 rounded-md p-3 flex justify-between items-center shadow-sm';
        div.innerHTML = `
          <div class="overflow-hidden">
            <p class="text-xs font-semibold text-gray-800 truncate">${member.role}</p>
            <p class="text-xs text-gray-500 truncate">${member.email}</p>
          </div>
          <button class="remove-btn text-xs text-red-500 hover:text-red-700 ml-2 focus:outline-none" data-index="${index}">
            Remove
          </button>
        `;
        membersList.appendChild(div);
      });

      // Attach remove handlers
      const removeBtns = membersList.querySelectorAll('.remove-btn');
      removeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.getAttribute('data-index'), 10);
          members.splice(idx, 1);
          renderMembers();
          resetStatus();
        });
      });
    }
  }

  function showError(msg) {
    emailError.textContent = msg;
    emailError.classList.remove('hidden');
  }

  function hideError() {
    emailError.textContent = '';
    emailError.classList.add('hidden');
  }

  function showLeaderError(msg) {
    leaderError.textContent = msg;
    leaderError.classList.remove('hidden');
  }

  function hideLeaderError() {
    leaderError.textContent = '';
    leaderError.classList.add('hidden');
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Reads and validates the leader's own details. If the Chrome profile
  // email was auto-detected, we use it directly and skip asking the leader
  // to type it again — that's the whole point of detectedLeader. Otherwise
  // we fall back to the manual email field. Name is never required: the
  // backend schema (Team.members[].name) already defaults to "", so forcing
  // it here would just be unnecessary friction with no data-model backing.
  function getValidatedLeader() {
    hideLeaderError();

    const role = leaderRoleInput.value.trim() || 'Team Leader';

    if (detectedLeader && detectedLeader.email) {
      const email = detectedLeader.email.toLowerCase();
      if (members.find((m) => m.email === email)) {
        showLeaderError('Your detected email cannot also be a teammate email.');
        return null;
      }
      return { name: detectedLeader.name || '', role, email };
    }

    const name = leaderNameInput.value.trim();
    const email = leaderEmailInput.value.trim().toLowerCase();

    if (!email) {
      showLeaderError('Your email is required — we could not detect it automatically from Chrome.');
      return null;
    }
    if (!EMAIL_REGEX.test(email)) {
      showLeaderError('Please enter a valid email format.');
      return null;
    }
    if (members.find((m) => m.email === email)) {
      showLeaderError('Your email cannot also be a teammate email.');
      return null;
    }

    return { name, role, email };
  }

  // Tries to auto-detect the leader's identity from the signed-in Chrome
  // profile. If it succeeds, hides the manual name/email inputs so the
  // leader never has to re-enter information the browser already knows.
  function tryDetectLeader() {
    if (!chrome.identity || !chrome.identity.getProfileUserInfo) return;

    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
      if (chrome.runtime.lastError || !info || !info.email) {
        return; // Not signed into Chrome, or restricted by policy — fall back to manual entry.
      }
      detectedLeader = { email: info.email, name: '' };
      leaderManualFields.classList.add('hidden');
      leaderDetected.textContent = `Detected from your Chrome profile: ${info.email}`;
      leaderDetected.classList.remove('hidden');
    });
  }

  
  function resetStatus() {
    statusMessage.textContent = '';
    statusMessage.classList.add('hidden');
  }

  addBtn.addEventListener('click', () => {
    hideError();
    resetStatus();
    
    const role = roleInput.value.trim() || 'Member';
    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      showError('Email is required.');
      return;
    }

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(email)) {
      showError('Please enter a valid email format.');
      return;
    }

    if (members.find(m => m.email === email)) {
      showError('This email is already added.');
      return;
    }

    members.push({ role, email });
    emailInput.value = '';
    roleInput.value = 'Member';
    renderMembers();
  });

  // ---------- Extraction & Messaging Helpers ----------
  function sendExtractMessage(tabId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Extraction timed out. The page might be incompatible or restricted."));
      }, 3000);

      chrome.tabs.sendMessage(tabId, { type: "CYHI_EXTRACT_FIELDS" }, (response) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  async function injectContentScript(tabId) {
    console.log("[CYHI POPUP] Injecting content script into tab", tabId);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch (e) {
      console.error("[CYHI POPUP] Injection failed:", e);
      throw new Error("Cannot access this page. Is it a restricted Chrome page?");
    }
  }

  async function extractFromActiveTab() {
    console.log("[CYHI POPUP] Querying active tab...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");
    console.log("[CYHI POPUP] Active tab:", tab.id, tab.url);

    try {
      console.log("[CYHI POPUP] Sending extraction message (attempt 1)");
      const res = await sendExtractMessage(tab.id);
      console.log("[CYHI POPUP] Extraction response (attempt 1):", res);
      return res;
    } catch (err) {
      console.log("[CYHI POPUP] Attempt 1 failed:", err.message);
      await injectContentScript(tab.id);
      console.log("[CYHI POPUP] Sending extraction message (attempt 2)");
      const res2 = await sendExtractMessage(tab.id);
      console.log("[CYHI POPUP] Extraction response (attempt 2):", res2);
      return res2;
    }
  }

  // ---------- Create Collaboration & Review Flow ----------
  sendBtn.addEventListener('click', async () => {
    console.log("[CYHI POPUP] Create Collaboration button clicked");
    if (members.length === 0) return;

    const leader = getValidatedLeader();
    if (!leader) return;

    sendBtn.disabled = true;
    sendBtn.textContent = 'Extracting...';
    hideError();
    resetStatus();

    try {
      console.log("[CYHI POPUP] Starting extraction...");
      const response = await extractFromActiveTab();
      console.log("[CYHI POPUP] Extraction successful");

      if (!response || !response.ok) {
        throw new Error(response?.error || "Unable to read fields from this page. Please reload the page and try again.");
      }

      const extractedForm = response.data;
      if (!extractedForm || !extractedForm.fields || extractedForm.fields.length === 0) {
        throw new Error("No form fields detected on this page.");
      }

      console.log("[CYHI POPUP] Changing button text to 'Creating Collaboration...'");
      sendBtn.textContent = 'Creating Collaboration...';

      const payload = {
        leader,
        sourceUrl: extractedForm.sourceUrl,
        sourceType: extractedForm.sourceType,
        fields: extractedForm.fields,
        members: members
      };

      console.log("[CYHI POPUP] Creating collaboration with payload:", payload);

      const res = await fetch(`${API_BASE_URL}/api/collaborations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      console.log("[CYHI POPUP] Collaboration HTTP status:", res.status);

      let responseData;

      try {
          responseData = await res.json();
      } catch (jsonErr) {
          throw new Error(
              res.status >= 500
                  ? "CYHI server error. Check the backend console."
                  : "Invalid response from CYHI server."
          );
      }

      if (!res.ok) {
          let errorMsg = "Unable to create collaboration.";

          if (responseData.details && Array.isArray(responseData.details)) {
              errorMsg = responseData.details.join(", ");
          } else if (responseData.error) {
              errorMsg = responseData.error;
          }

          throw new Error(errorMsg);
      }

      console.log("[CYHI] Collaboration created:", responseData);

      const { formId, teamId } = responseData;

      if (!formId || !teamId) {
          throw new Error(
              "Collaboration was created, but the backend did not return a formId/teamId."
          );
      }

      // AI assignment MUST happen before anything else — the review page has
      // nothing to show and invitations would carry no assigned fields
      // without it. If this fails, stop here: no review page, no invitations.
      console.log("[CYHI POPUP] Generating AI field assignments...");
      sendBtn.textContent = 'Assigning fields (AI)...';

      const aiRes = await fetch(`${API_BASE_URL}/api/forms/${encodeURIComponent(formId)}/ai-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId })
      });

      let aiData;
      try {
          aiData = await aiRes.json();
      } catch (jsonErr) {
          throw new Error(
              aiRes.status >= 500
                  ? "AI assignment service/backend error. Check the backend console."
                  : "Invalid response from the AI assignment service."
          );
      }

      if (!aiRes.ok || !aiData.success) {
          throw new Error(
              (aiData.details && Array.isArray(aiData.details) && aiData.details.join(", ")) ||
              aiData.error ||
              "AI assignment failed. No invitations were sent."
          );
      }

      console.log("[CYHI] AI assignments generated:", aiData);

      // Hand off to the leader review page — invitations are sent from
      // there, only after the leader confirms the assignments.
      // Retain the real formId/teamId (and the selectors we already
      // extracted) against this exact page, so a later visit to the same
      // original form can offer to fill it from collected responses
      // without hardcoding or re-deriving any of these IDs.
      try {
        await chrome.storage.local.set({
          [storageKeyForUrl(extractedForm.sourceUrl)]: {
            formId,
            teamId,
            fields: extractedForm.fields,
            createdAt: Date.now(),
          },
        });
      } catch (storageErr) {
        console.error('[CYHI POPUP] Failed to persist collaboration state:', storageErr);
      }

      const reviewUrl = `${FRONTEND_BASE_URL}/review/${encodeURIComponent(formId)}?teamId=${encodeURIComponent(teamId)}`;
      chrome.tabs.create({ url: reviewUrl });

      statusMessage.textContent = "Assignments generated. Review opened in a new tab.";
      statusMessage.className =
          "text-xs text-center font-medium p-2 mb-4 rounded bg-green-50 text-green-700 border border-green-200";
      statusMessage.classList.remove("hidden");

      sendBtn.textContent = 'Review Opened';

      // Disable inputs — this popup's job is done; the review page takes over.
      addBtn.disabled = true;
      emailInput.disabled = true;
      roleInput.disabled = true;
      leaderNameInput.disabled = true;
      leaderRoleInput.disabled = true;
      leaderEmailInput.disabled = true;
    } catch (err) {
      console.error("[CYHI POPUP] Error:", err);
      const errMsg = (err && err.message) ? err.message : String(err);

      const finalMsg = errMsg === "Failed to fetch" || errMsg.includes("NetworkError")
        ? "Cannot connect to CYHI server. Make sure the backend is running."
        : errMsg;

      statusMessage.textContent = finalMsg;
      statusMessage.className = 'text-xs text-center font-medium p-2 mb-4 rounded bg-red-50 text-red-700 border border-red-200';
      statusMessage.classList.remove('hidden');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Create Collaboration & Review';
    }
  });

  // ---------- Fill Original Form Flow ----------
  let activeCollab = null; // { formId, teamId, fields, sourceUrl }

  function showCreateFlow() {
    fillSection.classList.add('hidden');
    leaderSection.classList.remove('hidden');
  }

  function showFillFlow() {
    leaderSection.classList.add('hidden');
    fillSection.classList.remove('hidden');
  }

  async function checkForExistingCollaboration() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;

      const stored = await chrome.storage.local.get(storageKeyForUrl(tab.url));
      const record = stored[storageKeyForUrl(tab.url)];
      if (record && record.formId && record.teamId) {
        activeCollab = { ...record, sourceUrl: tab.url };
        showFillFlow();
      }
    } catch (err) {
      console.error('[CYHI POPUP] Failed to check for existing collaboration:', err);
    }
  }

  function showFillResult(text, isError) {
    fillResult.textContent = text;
    fillResult.classList.remove('hidden');
    fillResult.style.color = isError ? '#b91c1c' : '#334155';
  }

  fillFormBtn.addEventListener('click', async () => {
    if (!activeCollab) return;

    fillFormBtn.disabled = true;
    fillFormBtn.textContent = 'Fetching responses...';
    fillResult.classList.add('hidden');

    try {
      // MongoDB (via this endpoint) is the source of truth for values —
      // the only thing we read from local storage is the selector/fieldId
      // mapping captured at extraction time.
      const res = await fetch(`${API_BASE_URL}/api/forms/${encodeURIComponent(activeCollab.formId)}/final`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data && data.error) || 'Unable to fetch final responses from the backend.');
      }

      const finalValues = data.finalValues || {};
      const fillList = (activeCollab.fields || [])
        .filter((f) => Object.prototype.hasOwnProperty.call(finalValues, f.fieldId))
        .map((f) => ({
          fieldId: f.fieldId,
          type: f.type,
          selectors: f.selectors,
          value: finalValues[f.fieldId],
        }));

      if (fillList.length === 0) {
        showFillResult('No collected responses are available yet for this form.', true);
        return;
      }

      fillFormBtn.textContent = 'Filling form...';

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      const fillMessage = { type: 'CYHI_FILL_FIELDS', fields: fillList };
      let fillRes;
      try {
        fillRes = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, fillMessage, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          });
        });
      } catch (err) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        fillRes = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, fillMessage, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          });
        });
      }

      if (!fillRes || !fillRes.ok) {
        throw new Error((fillRes && fillRes.error) || 'The page did not confirm the fields were filled.');
      }

      const filledCount = fillRes.results.filter((r) => r.filled).length;
      const missing = (data.missingFields || []).length;
      showFillResult(
        `Filled ${filledCount} of ${fillList.length} field(s) on the page.` +
          (missing > 0 ? ` ${missing} field(s) still have no submitted response.` : '') +
          ' Review the form yourself — CYHI never submits it for you.',
        filledCount < fillList.length
      );
    } catch (err) {
      showFillResult(err.message || 'Failed to fill the form.', true);
    } finally {
      fillFormBtn.disabled = false;
      fillFormBtn.textContent = 'Fill with collected responses';
    }
  });

  startNewBtn.addEventListener('click', () => {
    activeCollab = null;
    showCreateFlow();
  });

  // Initial render
  renderMembers();
  tryDetectLeader();
  checkForExistingCollaboration();
});