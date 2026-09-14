// content.js
// Extracts fields from the page into the normalized form contract shared
// with backend/models/Form.js. Keep this schema in lockstep with that file:
//   fieldId, index, type, label, placeholder, required, selectors{id,name,cssPath}

const FIELD_TYPES = ["text", "email", "number", "url", "select", "textarea"];

// Types we don't support extracting yet (MVP: ordinary text-ish inputs only).
const SKIP_INPUT_TYPES = new Set([
  "hidden", "submit", "button", "image", "reset", "file", "checkbox", "radio",
]);

function isExtractable(el) {
  if (el.disabled) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return !SKIP_INPUT_TYPES.has(type);
  }
  return false;
}

function mapType(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (type === "email" || type === "number" || type === "url") return type;
  return "text"; // covers text, tel, password, date, search, etc.
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/([^\w-])/g, "\\$1");
}

function getLabelText(el) {
  if (el.labels && el.labels.length > 0) {
    const text = el.labels[0].textContent.trim();
    if (text) return text;
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return placeholder.trim();

  const name = el.getAttribute("name");
  if (name) {
    return name
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  }

  return "Untitled field";
}

// Builds a short, reasonably stable path from a nearby ancestor down to the
// element, using tag + nth-of-type at each level. Not guaranteed unique on
// wildly dynamic pages, but good enough as a fallback when id/name are absent.
function buildCssPath(el, maxDepth = 4) {
  const parts = [];
  let node = el;
  let depth = 0;

  while (node && node.nodeType === 1 && depth < maxDepth) {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblingsOfType = Array.from(parent.children).filter(
      (sib) => sib.tagName === node.tagName
    );
    const nthOfType = siblingsOfType.indexOf(node) + 1;
    parts.unshift(`${tag}:nth-of-type(${nthOfType})`);

    if (node.id || node.tagName.toLowerCase() === "form") {
      node = null; // stop climbing once we hit something anchorable
    } else {
      node = parent;
      depth += 1;
    }
  }

  return parts.join(" > ");
}

function buildSelectors(el) {
  return {
    id: el.id ? `#${cssEscape(el.id)}` : "",
    name: el.getAttribute("name") ? `[name="${cssEscape(el.getAttribute("name"))}"]` : "",
    cssPath: buildCssPath(el),
  };
}

function detectSourceType() {
  return location.hostname.includes("docs.google.com") ? "google_forms" : "html";
}

function extractFields() {
  const candidates = Array.from(document.querySelectorAll("input, textarea, select")).filter(
    isExtractable
  );

  const fields = candidates.map((el, i) => ({
    fieldId: `f${i + 1}`, // 1-based ID
    index: i,             // 0-based index
    type: mapType(el),
    label: getLabelText(el),
    placeholder: el.getAttribute("placeholder") || "",
    required: el.required === true,
    selectors: buildSelectors(el),
  }));

  return {
    sourceUrl: location.href,
    sourceType: detectSourceType(),
    fields,
  };
}

// ---------------------------------------------------------------------
// Filling the original external form from collected responses (CYHI_FILL_FIELDS)
// ---------------------------------------------------------------------
// Locates the original DOM element for a field using the same selectors
// captured at extraction time, trying id, then name, then the fallback
// cssPath, in that order.
function locateElement(selectors) {
  if (!selectors) return null;
  if (selectors.id) {
    try {
      const el = document.querySelector(selectors.id);
      if (el) return el;
    } catch (e) {}
  }
  if (selectors.name) {
    try {
      const el = document.querySelector(selectors.name);
      if (el) return el;
    } catch (e) {}
  }
  if (selectors.cssPath) {
    try {
      const el = document.querySelector(selectors.cssPath);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}

// Sets a value the way the page's own JS will actually notice. Many modern
// forms (React, Vue, etc.) track input values through the framework's own
// state, not just the DOM attribute — plain `el.value = x` is silently
// ignored by those. Using the native property setter, then dispatching
// input/change events, makes the framework re-read the value like a real
// keystroke would.
function setNativeValue(el, value) {
  const tag = el.tagName;
  const proto =
    tag === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : tag === "SELECT"
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// For <select>, match the target value against an option's value first,
// then its visible text, since the final aggregated value may be stored as
// whichever the member's browser submitted.
function fillSelectField(el, value) {
  const target = String(value).trim().toLowerCase();
  const options = Array.from(el.options || []);
  const byValue = options.find((o) => o.value.trim().toLowerCase() === target);
  const byText = options.find((o) => o.textContent.trim().toLowerCase() === target);
  const match = byValue || byText;
  if (!match) return false;
  setNativeValue(el, match.value);
  return true;
}

// Fills fields only. Never submits the form and never clicks a submit
// button — the leader reviews and submits manually.
function fillFields(fields) {
  return (fields || []).map((f) => {
    const el = locateElement(f.selectors);
    if (!el) {
      return { fieldId: f.fieldId, filled: false, reason: "Element not found on the current page." };
    }
    try {
      if (el.tagName === "SELECT") {
        const ok = fillSelectField(el, f.value);
        return ok
          ? { fieldId: f.fieldId, filled: true }
          : { fieldId: f.fieldId, filled: false, reason: "No matching option in the select field." };
      }
      setNativeValue(el, f.value == null ? "" : String(f.value));
      return { fieldId: f.fieldId, filled: true };
    } catch (err) {
      return { fieldId: f.fieldId, filled: false, reason: err.message };
    }
  });
}

if (!window.CYHI_CONTENT_SCRIPT_LOADED) {
  window.CYHI_CONTENT_SCRIPT_LOADED = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CYHI_EXTRACT_FIELDS") {
      try {
        const data = extractFields();
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return false; // Synchronous response
    }

    if (message?.type === "CYHI_FILL_FIELDS") {
      try {
        const results = fillFields(message.fields);
        sendResponse({ ok: true, results });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return false; // Synchronous response
    }
  });
}