---
name: html-canvas-game
description: Builds a single self-contained HTML5 canvas game from a user topic such as snake, pong, breakout, or flappy bird. Use when the user asks for a canvas game, HTML game, browser game, arcade game, or a playable game in HTML/JavaScript.
---

# HTML Canvas Game

Deliver **one** `.html` file the user can open in a browser. No build step, no libraries, no extra assets unless the user asks.

## Output contract

Write a file named `{topic}-game.html` (e.g. `snake-game.html`).

The file MUST include:

| Slot | Required |
|------|----------|
| `<!DOCTYPE html>` + `<title>` | Yes |
| Inline `<style>` | Canvas centered, page fills the viewport, HUD readable |
| `<canvas id="game">` | Yes |
| Inline `<script>` | All game logic |
| Game loop | `requestAnimationFrame` + delta time |
| Input | Keyboard (and on-screen hints). Touch if the mechanic is tap/swipe |
| Collision | Walls, self, entities — whatever the topic needs |
| Score | Visible HUD, updates during play |
| Game over | Overlay or banner with the final score |
| Restart | `R` or click/tap on the overlay; resets state, not the page |

Do not split into `.js` / `.css`. Do not use Phaser, Three.js, jQuery, or npm.

## Topic → mechanics

Map the user's topic before writing code. Fill this table (keep it in comments at the top of the script):

```
// topic:
// movement: grid | continuous
// player:
// goal:
// fail:
// score:
```

**Examples**

| Topic | Movement | Player | Goal | Fail | Score |
|-------|----------|--------|------|------|-------|
| Snake | Grid | Growing chain | Eat food | Wall or self | +1 per food |
| Pong | Continuous | Paddle | Return ball | Ball past paddle | +1 per return or opponent miss |
| Breakout | Continuous | Paddle + ball | Clear bricks | Ball below paddle | +points per brick |
| Flappy | Continuous | Gravity + flap | Pass gaps | Hit pipe or ground | +1 per gap |
| Asteroids | Continuous | Rotate + thrust | Shoot rocks | Hit rock | +points per rock |
| Catcher | Continuous | Move bucket | Catch falling items | Miss N items | +1 per catch |

Unknown topic: pick the closest row, then change sprites, colors, and fail/score rules to match the theme. Prefer **grid** for tile/snake/maze; **continuous** for physics, paddles, flight.

## File skeleton

Adapt this shape. Replace `{Title}` and the mechanic blocks — do not ship an empty loop.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{Title}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #111; color: #eee; font-family: system-ui, sans-serif; }
    body { display: grid; place-items: center; }
    canvas { background: #1a1a1a; display: block; max-width: 100vw; max-height: 100vh; }
    #hud { position: fixed; top: 12px; left: 12px; font-variant-numeric: tabular-nums; }
    #overlay {
      display: none; position: fixed; inset: 0; place-items: center;
      background: rgba(0,0,0,.65); text-align: center;
    }
    #overlay.show { display: grid; }
  </style>
</head>
<body>
  <div id="hud">Score: <span id="score">0</span></div>
  <canvas id="game" width="480" height="480"></canvas>
  <div id="overlay">
    <div>
      <h1>Game over</h1>
      <p>Score: <span id="final">0</span></p>
      <p>Press R to restart</p>
    </div>
  </div>
  <script>
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    let score = 0;
    let running = true;
    let last = 0;

    function reset() { /* rebuild all mutable state; score = 0; running = true; hide overlay */ }
    function fail() {
      running = false;
      document.getElementById('final').textContent = String(score);
      document.getElementById('overlay').classList.add('show');
    }
    function setScore(n) {
      score = n;
      document.getElementById('score').textContent = String(score);
    }

    addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') { reset(); return; }
      if (!running) return;
      // topic input
    });

    function update(dt) { /* move, collide, score */ }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // entities + HUD hint (arrows / space)
    }

    function loop(t) {
      const dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      if (running) update(dt);
      draw();
      requestAnimationFrame(loop);
    }
    reset();
    requestAnimationFrame(loop);
  </script>
</body>
</html>
```

## Implementation rules

1. **Size the world first.** Grid games: integer cells (e.g. 20×20), draw with `cell = canvas.width / cols`. Continuous: fixed canvas, clamp positions to bounds.
2. **Separate update and draw.** Mutation only in `update`. `draw` reads state.
3. **Delta time.** Multiply continuous motion by `dt`. Grid steps use an accumulator (`stepEvery = 0.12`) so speed is stable.
4. **Input buffering.** Snake/grid: queue the next direction; reject 180° reverses. Paddles: keys held in a `Set`. Flap: impulse on keydown, not while held, unless the topic is "hold to fly".
5. **Collision.** Grid: index equality. Continuous: AABB (`ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by`) or circle vs circle.
6. **Spawn safely.** Food/items must not overlap the player. Retry a few times, then skip.
7. **Feel.** Distinct colors for player, hazards, pickups, background. Show controls on the canvas until the first input. Optional muted sounds via `AudioContext` beeps — never required.
8. **Restart** restores the initial state in `reset()`. Do not `location.reload()`.

## Snake (reference mapping)

Use this when the topic is snake or a close variant (caterpillar, worm, train).

- Grid 20×20, step ~8–12 Hz
- State: `dir`, `nextDir`, `body` as `{x,y}[]`, `food`, `score`
- Tick: unshift head = last head + dir; if head === food, grow and respawn food; else pop tail
- Fail: head out of bounds or head hits a body cell
- Keys: Arrow keys and WASD; ignore reverse (left vs right, up vs down)
- Draw: filled cells, food as a contrasting square, score in `#hud`

## After writing

Open the checklist:

- [ ] Single HTML file, no external URLs
- [ ] Playable with keyboard from a cold start
- [ ] Score visible; game over reachable; R restarts
- [ ] Canvas cleared every frame
- [ ] Title and overlay match the user's topic (not a leftover "Snake")
- [ ] No `while (true)` / busy loops; only `requestAnimationFrame`

If the user asks for a second topic, write a **new** file rather than bolting modes onto the first game unless they asked for a menu.
