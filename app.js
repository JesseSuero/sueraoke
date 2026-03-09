const screens = {
  setup: document.getElementById("screen-setup"),
  game: document.getElementById("screen-game"),
  win: document.getElementById("screen-win"),
};

const ui = {
  playersList: document.getElementById("players-list"),
  playerLimit: document.getElementById("player-limit"),
  startGame: document.getElementById("start-game"),
  drawCard: document.getElementById("draw-card"),
  nextTurn: document.getElementById("next-turn"),
  wordText: document.getElementById("word-text"),
  wordPoints: document.getElementById("word-points"),
  ringButtons: document.getElementById("ring-buttons"),
  lyricText: document.getElementById("lyric-text"),
  lyricCountdown: document.getElementById("lyric-countdown"),
  validateLyric: document.getElementById("validate-lyric"),
  validationResult: document.getElementById("validation-result"),
  validationList: document.getElementById("validation-list"),
  validatorStatus: document.getElementById("validator-status"),
  scoreList: document.getElementById("score-list"),
  winTitle: document.getElementById("win-title"),
  winScore: document.getElementById("win-score"),
};

const defaultNames = ["Jesse", "Samuel", "Oliver"];
let setupPlayers = defaultNames.map((name, index) => ({
  id: `p${index + 1}`,
  name,
}));

let deckData = null;
let state = null;
let speechRecognizer = null;
let finalTranscript = "";
let latestTranscript = "";
let silenceTimer = null;
let countdownTimer = null;
let initialSpeechTimer = null;
let hasSpeechStarted = false;
let validatorPoll = null;
const GAME_STATE_KEY = "lyricRushGameState";

const actions = {
  start: async () => {
    await ensureDeck();
    startGame();
  },
  "add-player": () => addSetupPlayer(),
  draw: () => startTurn(),
  next: () => nextTurn(),
  end: () => endGame(),
  restart: () => restartGame(),
  new: () => endGame(),
  "vote-invalid": () => registerVote(false),
  "retry-capture": () => retryCapture(),
  "validate-lyric": () => validateLyric(),
  "remove-word": () => removeWord(),
};

function setScreen(name) {
  Object.values(screens).forEach((screen) => {
    screen.classList.remove("screen-active");
  });
  screens[name].classList.add("screen-active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function flashCard() {
  const card = document.querySelector(".word-card");
  if (!card) return;
  card.animate(
    [
      { transform: "scale(1)", filter: "brightness(1)" },
      { transform: "scale(1.02)", filter: "brightness(1.1)" },
      { transform: "scale(1)", filter: "brightness(1)" },
    ],
    { duration: 260, easing: "ease-out" }
  );
}

function renderSetupPlayers() {
  ui.playersList.innerHTML = "";
  setupPlayers.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.dataset.playerId = player.id;

    const label = document.createElement("label");
    label.className = "player-input";
    const span = document.createElement("span");
    span.textContent = `Player ${index + 1}`;
    const input = document.createElement("input");
    input.type = "text";
    input.value = player.name;
    input.addEventListener("input", () => {
      player.name = input.value;
      updateStartState();
    });
    label.append(span, input);

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.dataset.removePlayer = player.id;
    remove.disabled = setupPlayers.length <= 2;

    row.append(label, remove);
    ui.playersList.append(row);
  });
  updateStartState();
}

function updateStartState() {
  const count = setupPlayers.length;
  ui.startGame.disabled = count < 2 || count > 6;
  ui.playerLimit.textContent = `${count} player${count === 1 ? "" : "s"} · 2-6 required.`;
}

function addSetupPlayer() {
  if (setupPlayers.length >= 6) return;
  const id = `p${Date.now()}`;
  setupPlayers.push({ id, name: `Player ${setupPlayers.length + 1}` });
  renderSetupPlayers();
}

function removeSetupPlayer(id) {
  if (setupPlayers.length <= 2) return;
  setupPlayers = setupPlayers.filter((player) => player.id !== id);
  renderSetupPlayers();
}

async function ensureDeck() {
  if (deckData) return;
  try {
    const response = await fetch("game_data/deck-words.json");
    if (!response.ok) throw new Error("Deck load failed");
    deckData = await response.json();
  } catch (error) {
    deckData = [
      { word: "love", points: 1 },
      { word: "night", points: 1 },
      { word: "dream", points: 1 },
      { word: "midnight", points: 1 },
      { word: "carousel", points: 2 },
      { word: "labyrinth", points: 2 },
    ];
  }
}

async function refreshDeckData() {
  try {
    const response = await fetch("game_data/deck-words.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Deck refresh failed");
    deckData = await response.json();
  } catch (error) {
    // Keep existing deckData on refresh failure.
  }
}

function shuffleDeck(list) {
  const array = list.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function startGame() {
  const players = setupPlayers.map((player) => ({
    id: player.id,
    name: player.name.trim() || "Player",
    score: 0,
    mutedUntilTurn: 0,
  }));
  state = {
    players,
    deck: shuffleDeck(deckData),
    discard: [],
    currentCard: null,
    queue: [],
    currentAttemptId: null,
    phase: "idle",
    turn: 0,
    votes: { valid: 0, invalid: 0, remaining: 0, threshold: 0 },
  };
  setScreen("game");
  renderGame();
  startValidatorPolling();
  saveGameState();
}

function restartGame() {
  if (!state) return;
  state.players.forEach((player) => {
    player.score = 0;
    player.mutedUntilTurn = 0;
  });
  state.deck = shuffleDeck(deckData);
  state.discard = [];
  state.currentCard = null;
  state.queue = [];
  state.currentAttemptId = null;
  state.phase = "idle";
  state.turn = 0;
  state.votes = { valid: 0, invalid: 0, remaining: 0, threshold: 0 };
  setScreen("game");
  renderGame();
  startValidatorPolling();
  saveGameState();
}

function endGame() {
  state = null;
  stopSpeechCapture();
  stopValidatorPolling();
  setScreen("setup");
  renderSetupPlayers();
  clearGameState();
}

function startTurn() {
  if (!state) return;
  if (state.currentCard && state.phase !== "resolved" && state.phase !== "idle") {
    return;
  }
  state.turn += 1;
  state.queue = [];
  state.currentAttemptId = null;
  state.phase = "ringin";
  state.votes = { valid: 0, invalid: 0, remaining: 0, threshold: 0 };
  resetTranscript();
  resetValidation();
  drawCardFromServer();
}

function nextTurn() {
  if (!state) return;
  if (!state.currentCard) {
    startTurn();
    return;
  }
  if (state.phase === "voting" && state.currentAttemptId) {
    resolveAttempt(true);
    return;
  }
  if (state.phase === "resolved") {
    startTurn();
    return;
  }
  if (state.phase === "ringin" && state.queue.length === 0) {
    skipCurrentCard();
  }
}

async function skipCurrentCard() {
  if (!state || !state.currentCard) return;
  const skippedCard = state.currentCard;
  state.currentCard = null;
  state.queue = [];
  state.currentAttemptId = null;
  state.phase = "ringin";
  state.votes = { valid: 0, invalid: 0, remaining: 0, threshold: 0 };
  state.turn += 1;
  resetTranscript();
  resetValidation();

  try {
    await requestSkipUpdate(skippedCard);
    await refreshDeckData();
  } catch (error) {
    const deckIndex = state.deck.findIndex(
      (card) => card.word.toLowerCase() === skippedCard.word.toLowerCase()
    );
    if (deckIndex !== -1) {
      if (skippedCard.points === 1) {
        state.deck[deckIndex].points = 2;
      } else if (skippedCard.points === 2) {
        state.deck[deckIndex].points = 3;
      } else if (skippedCard.points === 3) {
        state.deck.splice(deckIndex, 1);
      }
    }
  }
  await drawCardFromServer();
}

async function requestSkipUpdate(card) {
  const response = await fetch("http://localhost:8787/skip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word: card.word, points: card.points }),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || "Skip update failed");
  }
  await response.json().catch(() => ({}));
}

async function removeWord() {
  if (!state || !state.currentCard) return;
  const removedCard = state.currentCard;
  state.currentCard = null;
  state.queue = [];
  state.currentAttemptId = null;
  state.phase = "ringin";
  state.votes = { valid: 0, invalid: 0, remaining: 0, threshold: 0 };
  resetTranscript();
  resetValidation();

  try {
    const response = await fetch("http://localhost:8787/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: removedCard.word }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || "Remove failed");
    }
    await response.json().catch(() => ({}));
    await refreshDeckData();
  } catch (error) {
    const deckIndex = state.deck.findIndex(
      (card) => card.word.toLowerCase() === removedCard.word.toLowerCase()
    );
    if (deckIndex !== -1) {
      state.deck.splice(deckIndex, 1);
    }
  }

  await drawCardFromServer();
}

async function drawCardFromServer() {
  try {
    const response = await fetch("http://localhost:8787/draw", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Draw failed");
    }
    const data = await response.json();
    if (!data.card) {
      throw new Error("No card returned");
    }
    state.currentCard = data.card;
  } catch (error) {
    await ensureDeck();
    state.deck = shuffleDeck(deckData);
    state.discard = [];
    state.currentCard = state.deck.pop() || null;
  }
  flashCard();
  renderGame();
}

function isMuted(player) {
  return player.mutedUntilTurn === state.turn;
}

function ringIn(playerId) {
  if (!state.currentCard) return;
  if (!["ringin", "voting"].includes(state.phase)) return;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || isMuted(player)) return;
  if (state.currentAttemptId === playerId) return;
  if (state.queue.includes(playerId)) return;
  state.queue.push(playerId);
  if (!state.currentAttemptId) {
    setAttemptFromQueue();
  } else {
    renderGame();
  }
}

function setAttemptFromQueue() {
  if (state.queue.length === 0) {
    state.currentAttemptId = null;
    state.phase = "ringin";
    stopSpeechCapture();
    renderGame();
    return;
  }
  state.currentAttemptId = state.queue.shift();
  const voters = 1;
  state.votes = {
    valid: 0,
    invalid: 0,
    remaining: voters,
    threshold: 1,
  };
  state.phase = "voting";
  startSpeechCapture();
  renderGame();
}

function registerVote(isValid) {
  if (!state || state.phase !== "voting") return;
  if (state.votes.remaining <= 0) return;
  if (isValid) {
    state.votes.valid += 1;
  } else {
    state.votes.invalid += 1;
  }
  state.votes.remaining -= 1;
  if (state.votes.valid >= state.votes.threshold) {
    resolveAttempt(true);
    return;
  }
  if (state.votes.invalid >= state.votes.threshold) {
    resolveAttempt(false);
    return;
  }
  if (state.votes.remaining === 0) {
    resolveAttempt(state.votes.valid > state.votes.invalid);
    return;
  }
  renderGame();
}

function resolveAttempt(isValid) {
  const attemptId = state.currentAttemptId;
  const attemptPlayer = state.players.find((player) => player.id === attemptId);
  if (!attemptPlayer) return;

  if (isValid) {
    stopSpeechCapture();
    attemptPlayer.score += state.currentCard.points;
    state.discard.push(state.currentCard);
    state.currentCard = null;
    state.queue = [];
    state.currentAttemptId = null;
    state.phase = "resolved";
    const winner = state.players.find((player) => player.score >= 10);
    if (winner) {
      ui.winTitle.textContent = `${winner.name} Wins!`;
      ui.winScore.textContent = `Final score: ${winner.score}`;
      stopValidatorPolling();
      setScreen("win");
      return;
    }
  } else {
    stopSpeechCapture();
    attemptPlayer.mutedUntilTurn = state.turn + 1;
    state.currentAttemptId = null;
    if (state.queue.length > 0) {
      setAttemptFromQueue();
      return;
    }
    state.phase = "ringin";
    resetTranscript();
    resetValidation();
  }
  renderGame();
}

function resetTranscript() {
  finalTranscript = "";
  latestTranscript = "";
  ui.lyricText.textContent = "...";
  ui.lyricCountdown.textContent = "--";
}

function resetValidation() {
  ui.validationResult.innerHTML = "<p class=\"muted\">No validation yet.</p>";
  ui.validationList.innerHTML = "";
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function startCountdown(durationMs) {
  clearCountdown();
  const endAt = Date.now() + durationMs;
  const update = () => {
    const remaining = Math.max(0, endAt - Date.now());
    ui.lyricCountdown.textContent = (remaining / 1000).toFixed(1);
    if (remaining <= 0) {
      clearCountdown();
    }
  };
  update();
  countdownTimer = setInterval(update, 100);
}

function scheduleSilenceStop() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
  }
  silenceTimer = setTimeout(() => {
    stopSpeechCapture("Paused after 2 seconds of silence.");
  }, 2000);
  startCountdown(2000);
}

function startSpeechCapture() {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    return;
  }
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!speechRecognizer) {
    speechRecognizer = new Recognition();
    speechRecognizer.lang = "en-US";
    speechRecognizer.interimResults = true;
    speechRecognizer.continuous = true;
    speechRecognizer.onresult = (event) => {
      if (!hasSpeechStarted) {
        hasSpeechStarted = true;
        if (initialSpeechTimer) {
          clearTimeout(initialSpeechTimer);
          initialSpeechTimer = null;
        }
      }
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${result[0].transcript}`.trim();
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      const displayText = `${finalTranscript} ${interimTranscript}`.trim();
      ui.lyricText.textContent = displayText || "...";
      latestTranscript = displayText.trim();
      scheduleSilenceStop();
    };
    speechRecognizer.onerror = () => {
    };
    speechRecognizer.onend = () => {
      if (state && state.phase === "voting") {
      }
    };
  }
  finalTranscript = "";
  latestTranscript = "";
  ui.lyricText.textContent = "...";
  hasSpeechStarted = false;
  if (initialSpeechTimer) {
    clearTimeout(initialSpeechTimer);
  }
  startCountdown(3000);
  initialSpeechTimer = setTimeout(() => {
    if (!hasSpeechStarted && state && state.phase === "voting") {
      resolveAttempt(false);
    }
  }, 3000);
  speechRecognizer.start();
}

function stopSpeechCapture(statusText) {
  if (!speechRecognizer) return;
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  if (initialSpeechTimer) {
    clearTimeout(initialSpeechTimer);
    initialSpeechTimer = null;
  }
  clearCountdown();
  try {
    speechRecognizer.stop();
  } catch (error) {
    // Ignore stop errors when already stopped.
  }
  ui.lyricCountdown.textContent = "--";
}

function retryCapture() {
  if (!state || state.phase !== "voting") return;
  stopSpeechCapture();
  startSpeechCapture();
}

async function validateLyric() {
  if (!state || state.phase !== "voting") return;
  stopSpeechCapture("Capture stopped for validation.");
  if (!latestTranscript) {
    ui.validationResult.innerHTML =
      "<p class=\"muted\">No lyrics captured yet.</p>";
    return;
  }
  ui.validationResult.innerHTML = "<p class=\"muted\">Searching Genius...</p>";
  ui.validationList.innerHTML = "";
  try {
    const endpoints = ["http://localhost:8787", "http://127.0.0.1:8787"];
    let response = null;
    let lastError = null;
    for (const baseUrl of endpoints) {
      try {
        response = await fetch(
          `${baseUrl}/validate?query=${encodeURIComponent(latestTranscript)}`
        );
        if (response) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (!response) {
      const hint =
        window.location.protocol === "https:"
          ? "Mixed content blocked. Use http:// for the app."
          : "Could not reach validator server.";
      throw new Error(
        `${hint} ${lastError ? lastError.message : ""}`.trim()
      );
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || "Validation failed");
    }
    const data = await response.json();
    if (!data.found) {
      ui.validationResult.innerHTML =
        "<p class=\"muted\">No matching lyric found.</p>";
      ui.validationList.innerHTML = "";
      return;
    }
    ui.validationResult.innerHTML =
      "<p class=\"muted\">Best matches:</p>";
    ui.validationList.innerHTML = data.matches
      .map(
        (match) => `
          <div class="validation-card">
            <div class="validation-title">${match.song} — ${match.artist}</div>
            <div class="validation-line">\"${match.line}\"</div>
          </div>
        `
      )
      .join("");
  } catch (error) {
    ui.validationResult.innerHTML = `<p class="muted">Validator unavailable: ${error.message}</p>`;
  }
}

function renderGame() {
  if (!state) return;
  const card = state.currentCard;
  if (!card) {
    ui.wordText.textContent = "READY?";
    ui.wordPoints.textContent = "Draw to start";
  } else {
    ui.wordText.textContent = card.word.toUpperCase();
    ui.wordPoints.textContent = `${card.points} pt`;
  }

  ui.drawCard.disabled = Boolean(state.currentCard);
  ui.nextTurn.disabled = state.phase !== "resolved";
  if (state.phase === "ringin" && state.queue.length === 0 && state.currentCard) {
    ui.nextTurn.disabled = false;
    ui.nextTurn.textContent = "Skip Card";
  } else {
    ui.nextTurn.textContent = "Next Turn";
  }

  ui.ringButtons.innerHTML = "";
  state.players.forEach((player) => {
    const button = document.createElement("button");
    button.textContent = player.name;
    button.dataset.ring = player.id;
    button.className = isMuted(player) ? "ghost" : "secondary";
    button.disabled =
      !state.currentCard ||
      !["ringin", "voting"].includes(state.phase) ||
      isMuted(player);
    ui.ringButtons.append(button);
  });

  if (!state.currentCard) {
    resetTranscript();
  }
  const invalidButton = document.querySelector(
    "[data-action=\"vote-invalid\"]"
  );
  if (invalidButton) {
    invalidButton.disabled =
      state.phase !== "voting" || state.votes.remaining === 0;
  }
  const retryButton = document.getElementById("retry-capture");
  if (retryButton) {
    retryButton.disabled = state.phase !== "voting";
  }
  if (ui.validateLyric) {
    ui.validateLyric.disabled = state.phase !== "voting";
  }
  updateValidatorStatus();

  ui.scoreList.innerHTML = "";
  state.players.forEach((player) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = player.name;
    if (isMuted(player)) {
      name.classList.add("muted-name");
    }
    const score = document.createElement("span");
    score.textContent = player.score;
    item.append(name, score);
    ui.scoreList.append(item);
  });

  saveGameState();
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) {
    const action = button.dataset.action;
    if (actions[action]) {
      actions[action]();
    }
  }
  const removeButton = event.target.closest("[data-remove-player]");
  if (removeButton) {
    removeSetupPlayer(removeButton.dataset.removePlayer);
  }
  const ringButton = event.target.closest("[data-ring]");
  if (ringButton) {
    ringIn(ringButton.dataset.ring);
  }
});

ui.lyricText.addEventListener("input", () => {
  latestTranscript = ui.lyricText.textContent.trim();
});

renderSetupPlayers();

function saveGameState() {
  if (!state) return;
  const snapshot = {
    players: state.players,
    deck: state.deck,
    discard: state.discard,
    currentCard: state.currentCard,
    queue: state.queue,
    currentAttemptId: state.currentAttemptId,
    phase: state.phase,
    turn: state.turn,
    votes: state.votes,
  };
  localStorage.setItem(GAME_STATE_KEY, JSON.stringify(snapshot));
}

function clearGameState() {
  localStorage.removeItem(GAME_STATE_KEY);
}

function loadGameState() {
  const raw = localStorage.getItem(GAME_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.players)) {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function restoreGameState() {
  const saved = loadGameState();
  if (!saved) return;
  state = {
    players: saved.players || [],
    deck: saved.deck || [],
    discard: saved.discard || [],
    currentCard: saved.currentCard || null,
    queue: saved.queue || [],
    currentAttemptId: saved.currentAttemptId || null,
    phase: saved.phase || "idle",
    turn: saved.turn || 0,
    votes: saved.votes || {
      valid: 0,
      invalid: 0,
      remaining: 0,
      threshold: 0,
    },
  };
  setScreen("game");
  renderGame();
  startValidatorPolling();
}

restoreGameState();

function startValidatorPolling() {
  if (!ui.validatorStatus) return;
  if (validatorPoll) return;
  checkValidator();
  validatorPoll = setInterval(checkValidator, 5000);
}

function stopValidatorPolling() {
  if (validatorPoll) {
    clearInterval(validatorPoll);
    validatorPoll = null;
  }
}

async function checkValidator() {
  if (!ui.validatorStatus) return;
  const endpoints = ["http://localhost:8787", "http://127.0.0.1:8787"];
  let ok = false;
  for (const baseUrl of endpoints) {
    try {
      const response = await fetch(`${baseUrl}/health`, { cache: "no-store" });
      if (response.ok) {
        ok = true;
        break;
      }
    } catch (error) {
      // Ignore and try next.
    }
  }
  ui.validatorStatus.innerHTML = ok
    ? "<span class=\"status-dot\"></span>Running"
    : "<span class=\"status-dot\"></span>Stopped";
  ui.validatorStatus.classList.toggle("status-running", ok);
  ui.validatorStatus.classList.toggle("status-stopped", !ok);
}

function updateValidatorStatus() {
  if (!ui.validatorStatus) return;
  if (
    !ui.validatorStatus.classList.contains("status-running") &&
    !ui.validatorStatus.classList.contains("status-stopped")
  ) {
    ui.validatorStatus.innerHTML =
      "<span class=\"status-dot\"></span>Checking...";
  }
}
