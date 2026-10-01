// Mark that JavaScript is running (so reveal styles only apply when JS works)
document.documentElement.classList.add("js");

// Mobile menu
const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");

function setMenu(open) {
  navMenu.classList.toggle("open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}
menuBtn.addEventListener("click", () => setMenu(!navMenu.classList.contains("open")));
navMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

// Scroll reveal
const items = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("visible"); io.unobserve(entry.target); }
    });
  }, { threshold: 0.12 });
  items.forEach((el) => io.observe(el));
} else {
  items.forEach((el) => el.classList.add("visible"));
}

// Footer year
document.getElementById("year").textContent = new Date().getFullYear();

// Leadership "View more" toggle
const rolesToggle = document.getElementById("rolesToggle");
const moreRoles = document.getElementById("moreRoles");
rolesToggle.addEventListener("click", () => {
  const open = moreRoles.hidden;
  moreRoles.hidden = !open;
  rolesToggle.setAttribute("aria-expanded", String(open));
  rolesToggle.textContent = open ? "View less" : "View more";
});

// "Let's Connect" buttons carry data-connect. For now they scroll to Contact (normal link).
// Later, the chatbot can attach to document.querySelectorAll("[data-connect]").

/* =====================================================================
   Ask My Portfolio chatbot (frontend only)
   The browser talks ONLY to /api/chat. No API key and no system prompt here.
   ===================================================================== */
(function () {
  const toggle = document.getElementById("chatbotToggle");
  const win = document.getElementById("chatbotWindow");
  if (!toggle || !win) return;

  const closeBtn = document.getElementById("chatbotClose");
  const messages = document.getElementById("chatbot-messages");
  const typing = document.getElementById("chatbot-typing");
  const chips = document.getElementById("chatbotChips");
  const form = document.getElementById("chatbotForm");
  const input = document.getElementById("chatbot-input");
  const sendBtn = document.getElementById("chatbotSend");

  const STORE_KEY = "askMyPortfolioChat";   // sessionStorage: cleared when the tab closes
  const GREETING = "Hi! I'm Eshal's portfolio assistant. Ask me about my background, skills, projects or work.";
  let history = [];                          // [{ role: "user" | "model", text }]
  let busy = false;
  let opener = null;

  function scrollDown() { messages.scrollTop = messages.scrollHeight; }

  function addMessage(text, who, isError) {
    const el = document.createElement("div");
    el.className = "chatbot-msg " + (who === "user" ? "user-msg" : "bot-msg") + (isError ? " error" : "");
    el.textContent = text;                   // textContent keeps visitor/AI text safe
    messages.insertBefore(el, typing);
    scrollDown();
  }

  function save() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(history)); } catch (e) { /* storage unavailable */ } }

  function restore() {
    addMessage(GREETING, "bot");
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]");
      if (Array.isArray(saved)) {
        saved.forEach((m) => {
          if (m && typeof m.text === "string" && (m.role === "user" || m.role === "model")) {
            history.push({ role: m.role, text: m.text });
            addMessage(m.text, m.role === "user" ? "user" : "bot");
          }
        });
      }
    } catch (e) { history = []; }
    if (history.length) chips.hidden = true;
  }

  function setOpen(open) {
    win.classList.toggle("active", open);
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close Ask My Portfolio chat" : "Open Ask My Portfolio chat");
    if (open) { opener = document.activeElement; scrollDown(); setTimeout(() => input.focus(), 50); }
    else if (opener && opener.focus) { opener.focus(); }
  }

  function setBusy(state) {
    busy = state;
    typing.hidden = !state;
    input.disabled = state;
    sendBtn.disabled = state;
    if (state) scrollDown(); else input.focus();
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;               // empty input or already waiting
    chips.hidden = true;
    addMessage(text, "user");
    input.value = "";
    setBusy(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);   // timeout
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(-10) }),
        signal: controller.signal,
      });
      const raw = await response.text();     // read as text first: safe for empty replies
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
      if (!response.ok || !data.reply) throw new Error(data.error || "Request failed");

      history.push({ role: "user", text: text }, { role: "model", text: data.reply });
      save();
      addMessage(data.reply, "bot");
    } catch (err) {
      const msg = err.name === "AbortError"
        ? "The assistant took too long to answer. Please try again."
        : (err.message && err.message !== "Request failed" && err.message !== "Failed to fetch"
            ? err.message
            : "Sorry, I couldn't reach the assistant. Please check your connection and try again.");
      addMessage(msg, "bot", true);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  // Events
  toggle.addEventListener("click", () => setOpen(!win.classList.contains("active")));
  closeBtn.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && win.classList.contains("active")) setOpen(false); });
  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });   // Enter also submits
  chips.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => send(b.textContent)));

  // "Let's Connect" buttons (navigation bar + hero) open the chatbot
  document.querySelectorAll("[data-connect]").forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); setOpen(true); });
  });

  restore();
})();
