"use strict";
// Local test server: serves the portfolio and runs api/chat.js (like Vercel does online).
// Run with:  npm start      then open  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

// Tiny .env reader (no extra package needed). Real environment variables win.
try {
  fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
} catch { console.log("No .env file found. Create one (see .env.example) so the chatbot can answer."); }

const chatHandler = require("./api/chat");
const PORT = process.env.PORT || 3000;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon" };
// Only these public files are served. .env, api/, server.js etc. can never be downloaded.
const PUBLIC_FILES = new Set(["index.html", "style.css", "script.js"]);

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);

  if (url === "/api/chat") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 20000) req.destroy(); });
    req.on("end", async () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = null; }
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (data) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
      await chatHandler(req, res);
    });
    return;
  }

  const rel = path.normalize(url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  const allowed = PUBLIC_FILES.has(rel) || rel.startsWith("assets" + path.sep);
  const file = path.join(__dirname, rel);
  if (!allowed || !file.startsWith(__dirname)) { res.writeHead(404); return res.end("Not found"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Portfolio running at http://localhost:${PORT}`));
