const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim();
    if (!process.env[key.trim()]) {
      process.env[key.trim()] = value;
    }
  });
}

const ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;

function getAccessToken() {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "Missing GENIUS_ACCESS_TOKEN. Add it to .env as a Genius client access token."
    );
  }
  return ACCESS_TOKEN;
}

function cleanText(text) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLyrics(html) {
  const containers = [...html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi)];
  if (containers.length === 0) {
    return "";
  }
  const combined = containers.map((match) => cleanText(match[1])).join("\n");
  return combined;
}

function pickLine(lyrics, query) {
  if (!lyrics) return "";
  const lines = lyrics
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lowered = query.toLowerCase();
  const words = lowered.split(/\s+/).filter((word) => word.length > 3);
  const phrase = lowered.split(/\s+/).slice(0, 6).join(" ");

  let match = lines.find((line) => line.toLowerCase().includes(phrase));
  if (match) return match;

  match = lines.find((line) =>
    words.some((word) => line.toLowerCase().includes(word))
  );
  return match || "";
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

async function readJson(filePath) {
  const data = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(data);
}

async function writeJson(filePath, data) {
  const payload = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(filePath, payload, "utf8");
}

async function loadUsedWords() {
  const usedPath = path.join(__dirname, "game_data", "used-words.json");
  try {
    const used = await readJson(usedPath);
    return Array.isArray(used) ? used : [];
  } catch (error) {
    return [];
  }
}

async function saveUsedWords(words) {
  const usedPath = path.join(__dirname, "game_data", "used-words.json");
  await fs.promises.mkdir(path.dirname(usedPath), { recursive: true });
  await writeJson(usedPath, words);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === "/draw") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const deckPath = path.join(__dirname, "game_data", "deck-words.json");
      const deck = await readJson(deckPath);
      if (!Array.isArray(deck) || deck.length === 0) {
        sendJson(res, 409, { error: "Deck is empty" });
        return;
      }
      const used = await loadUsedWords();
      const usedSet = new Set(used);
      let remaining = deck.filter((card) => !usedSet.has(card.word));
      if (remaining.length === 0) {
        usedSet.clear();
        remaining = deck.slice();
      }
      const choice = remaining[Math.floor(Math.random() * remaining.length)];
      usedSet.add(choice.word);
      await saveUsedWords([...usedSet]);
      sendJson(res, 200, { card: choice });
      return;
    } catch (error) {
      sendJson(res, 500, { error: `Draw error: ${error.message}` });
      return;
    }
  }
  if (url.pathname === "/skip") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
          data += chunk;
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
      const payload = JSON.parse(body || "{}");
      const word = String(payload.word || "").trim();
      const points = Number(payload.points);
      if (!word || ![1, 2].includes(points)) {
        sendJson(res, 400, { error: "Missing word or points" });
        return;
      }
      const deckPath = path.join(__dirname, "game_data", "deck-words.json");
      const deck = await readJson(deckPath);
      const deckIndex = deck.findIndex(
        (card) => card.word.toLowerCase() === word.toLowerCase()
      );
      if (deckIndex === -1) {
        sendJson(res, 404, { error: "Word not found in deck" });
        return;
      }
      if (points === 1) {
        deck[deckIndex].points = 2;
      } else if (points === 2) {
        deck[deckIndex].points = 3;
      } else if (points === 3) {
        deck.splice(deckIndex, 1);
        const used = await loadUsedWords();
        const updatedUsed = used.filter(
          (usedWord) => usedWord.toLowerCase() !== word.toLowerCase()
        );
        await saveUsedWords(updatedUsed);
      }
      await writeJson(deckPath, deck);
      sendJson(res, 200, { updated: true });
      return;
    } catch (error) {
      sendJson(res, 500, { error: `Skip error: ${error.message}` });
      return;
    }
  }

  if (url.pathname === "/remove") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
          data += chunk;
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
      const payload = JSON.parse(body || "{}");
      const word = String(payload.word || "").trim();
      if (!word) {
        sendJson(res, 400, { error: "Missing word" });
        return;
      }
      const deckPath = path.join(__dirname, "game_data", "deck-words.json");
      const deck = await readJson(deckPath);
      const deckIndex = deck.findIndex(
        (card) => card.word.toLowerCase() === word.toLowerCase()
      );
      if (deckIndex === -1) {
        sendJson(res, 404, { error: "Word not found in deck" });
        return;
      }
      deck.splice(deckIndex, 1);
      const used = await loadUsedWords();
      const updatedUsed = used.filter(
        (usedWord) => usedWord.toLowerCase() !== word.toLowerCase()
      );
      await saveUsedWords(updatedUsed);

      await writeJson(deckPath, deck);
      sendJson(res, 200, { removed: true });
      return;
    } catch (error) {
      sendJson(res, 500, { error: `Remove error: ${error.message}` });
      return;
    }
  }

  if (url.pathname !== "/validate") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const query = (url.searchParams.get("query") || "").trim();
  if (!query) {
    sendJson(res, 400, { error: "Missing query" });
    return;
  }
  try {
    const token = getAccessToken();
    const search = await fetch(
      `https://api.genius.com/search?q=${encodeURIComponent(query.slice(0, 120))}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    if (!search.ok) {
      sendJson(res, 502, { error: "Search failed" });
      return;
    }
    const searchData = await search.json();
    const hits = searchData?.response?.hits?.slice(0, 5) || [];
    if (hits.length === 0) {
      sendJson(res, 200, { found: false });
      return;
    }
    const matches = [];
    for (const hit of hits) {
      const result = hit?.result;
      if (!result?.url) {
        continue;
      }
      const page = await fetch(result.url);
      if (!page.ok) {
        continue;
      }
      const html = await page.text();
      const lyrics = extractLyrics(html);
      const line = pickLine(lyrics, query);
      if (!line) {
        continue;
      }
      matches.push({
        song: result.title,
        artist: result.primary_artist?.name || "Unknown",
        line,
      });
    }
    if (matches.length === 0) {
      sendJson(res, 200, { found: false });
      return;
    }
    sendJson(res, 200, { found: true, matches });
  } catch (error) {
    sendJson(res, 500, { error: `Validation error: ${error.message}` });
  }
});

server.listen(8787, () => {
  console.log("Lyric validator running on http://localhost:8787");
});
