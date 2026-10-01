"use strict";
/**
 * /api/chat  (Vercel serverless function; also used by server.js locally)
 * Browser sends { message, history }. This file adds the SECRET key and the
 * system prompt, calls Gemini, and sends back only { reply }.
 */
const SYSTEM_PROMPT = require("./_systemPrompt");

// Models are tried in order. If one is unavailable (404) or busy (429/503), the next is tried.
// You can put your preferred model first by setting GEMINI_MODEL in .env / Vercel.
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.8-flash"];
const MODELS = [process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);

const MAX_MESSAGE = 500;      // characters per visitor message
const MAX_HISTORY = 10;       // previous messages sent along for context
const REQUEST_TIMEOUT_MS = 15000;

// Very small per-IP limit (best effort; resets when the function restarts)
const hits = new Map();
function tooManyRequests(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count += 1;
  hits.set(ip, rec);
  return rec.count > 15;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const items = history
    .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 1000) }] }));
  while (items.length && items[0].role !== "user") items.shift(); // Gemini wants to start with the user
  return items;
}

async function callGemini(model, apiKey, contents) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("YOUR_SECRET_KEY")) {
    console.error("GEMINI_API_KEY is missing. Add it to .env (local) or Vercel Environment Variables.");
    return res.status(500).json({ error: "The chatbot is not set up yet. Please try again later." });
  }

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (tooManyRequests(ip)) {
    return res.status(429).json({ error: "You are sending messages very quickly. Please wait a minute and try again." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const message = body && typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Please type a message first." });
  if (message.length > MAX_MESSAGE) return res.status(400).json({ error: `Please keep your message under ${MAX_MESSAGE} characters.` });

  const contents = [...cleanHistory(body.history), { role: "user", parts: [{ text: message }] }];

  try {
    let lastStatus = 500;
    for (const model of MODELS) {
      const response = await callGemini(model, apiKey, contents);
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }

      if (response.ok) {
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const reply = Array.isArray(parts) ? parts.map((p) => p.text || "").join("").trim() : "";
        if (reply) return res.status(200).json({ reply });
        console.error("Empty reply from", model, data.promptFeedback || "");
        return res.status(502).json({ error: "I could not come up with an answer. Please try asking in a different way." });
      }

      lastStatus = response.status;
      console.error("Gemini error", model, response.status, data.error && data.error.message); // private log only
      if (![404, 429, 503, 500].includes(response.status)) break; // e.g. bad key: other models will not help
    }

    if (lastStatus === 429) return res.status(429).json({ error: "I am getting a lot of questions right now. Please try again in a minute." });
    return res.status(502).json({ error: "Sorry, the assistant is not available right now. Please try again later." });
  } catch (err) {
    console.error("Chat function error:", err && err.name);
    if (err && err.name === "AbortError") return res.status(504).json({ error: "The assistant took too long to answer. Please try again." });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
