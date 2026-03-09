# Karaoke Chaos Clone MVP

## Rules Spec (Concise)

- Players: 2-6 on a single device.
- Goal: First player to reach 10 points wins.
- Deck: 100 cards (65 easy = 1 point, 35 hard = 2 points). One word per card.
- Turn flow:
  1. Draw/flip a card to reveal the word.
  2. Any non-muted player can ring in by pressing their button.
  3. Ring-in order determines attempt order.
  4. The current player announces a lyric aloud that contains the word as a standalone word.
  5. Majority vote (excluding the attempting player) decides valid/invalid.
  6. If valid: award points, discard card, clear ring-in queue, end turn.
  7. If invalid: player is muted for the next turn, remove them from the queue; next ring-in (if any) may attempt; if no one remains, discard card and end turn.
- Muted rule: A muted player cannot ring in on the current or next card only; mute clears after the next card is resolved.
- Word match rule: The word must appear as a standalone word in the lyric (case-insensitive). Punctuation or possessive/plural forms are allowed if the base word appears (e.g., "love" matches "love's").

## UI Flow (MVP)

1. Start / Setup Screen
   - Title + short rules blurb.
   - Add players (2-6), with name and color.
   - Score target fixed at 10 (later configurable).
   - Start Game button.

2. Gameplay Screen
   - Current word card (face down until "Draw"; then revealed).
   - Ring-in buttons for each player (disabled if muted).
   - Ring-in queue list (order of attempts).
   - Vote controls: "Valid" / "Invalid" with a simple majority tally.
   - Scoreboard with total points and muted indicator.
   - Action buttons: Draw Card, Next Turn, Undo (optional).

3. Win Screen
   - Winner name + score.
   - Play Again (reshuffle deck) / New Game (back to setup).

## Core States

- Pre-game setup
- In-turn: waiting for ring-in
- In-turn: resolving attempt (vote)
- End-of-turn: apply points/mute, advance
- Game over

## Stretch (Not MVP)

- Optional lyric capture (speech-to-text) and verification against lyric sources.
