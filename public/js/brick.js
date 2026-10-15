// ==========================================
// CLIENT BRICK BLAST (CASSE-BRIQUES ARCADE 1v1)
// ==========================================
const socket = io({
  transports: ['websocket', 'polling']
});

const canvas = document.getElementById('brickCanvas');
const ctx = canvas.getContext('2d');

// DOM Elements
const matchStatusBadge = document.getElementById('match-status-badge');
const playerNameElem = document.getElementById('player-name');
const playerScoreElem = document.getElementById('player-score');
const playerLivesElem = document.getElementById('player-lives');
const playerComboElem = document.getElementById('player-combo');
const rivalNameElem = document.getElementById('rival-name');
const rivalScoreElem = document.getElementById('rival-score');
const rivalLivesElem = document.getElementById('rival-lives');
const rivalBricksLeftElem = document.getElementById('rival-bricks-left');
const startPrompt = document.getElementById('start-prompt');
const gameOverlay = document.getElementById('game-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySubtitle = document.getElementById('overlay-subtitle');
const finalScoreElem = document.getElementById('final-score');
const btnRestart = document.getElementById('btn-restart');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnTouchAction = document.getElementById('btn-touch-action');
const btnHubExit = document.getElementById('btn-hub-exit');

let soundEnabled = true;
let isGameOver = false;
let myRole = 'p1';
let score = 0;
let lives = 3;
let combo = 0;
let comboTimer = 0;

// État de la raquette / canon
const paddle = {
  x: canvas.width / 2 - 55,
  y: canvas.height - 35,
  width: 110,
  height: 14,
  baseWidth: 110,
  speed: 9,
  isWide: false,
  wideExpires: 0,
  hasLaser: false,
  laserExpires: 0,
  hasFireball: false,
  fireballExpires: 0
};

// Balles actives
let balls = [];

// Grille de briques
let bricks = [];
const BRICK_ROWS = 6;
const BRICK_COLS = 9;
const BRICK_W = 70;
const BRICK_H = 22;
const BRICK_PADDING = 8;
const BRICK_OFFSET_LEFT = 25;
const BRICK_OFFSET_TOP = 45;

// Bonus qui tombent & lasers
let powerups = [];
let lasers = [];
let particles = [];

// Entrées Clavier & Souris
const keys = { left: false, right: false };
let mouseControl = false;

// Rejoindre la salle Brick Blast
socket.emit('brick_join');

// Rôle assigné par le serveur
socket.on('brick_role', (data) => {
  myRole = data.role; // 'p1', 'p2', ou 'spectator'
  updateMatchBadge(data);
});

socket.on('brick_rival_update', (data) => {
  rivalScoreElem.textContent = data.score;
  rivalBricksLeftElem.textContent = `${data.bricksLeft} briques`;
  let hearts = '';
  for (let i = 0; i < data.lives; i++) hearts += '❤️';
  rivalLivesElem.textContent = hearts || '💀';

  if (data.isWinner) {
    endGame(false, `${data.name} a remporté le duel !`);
  }
});

function updateMatchBadge(data) {
  if (data.isDuel) {
    matchStatusBadge.textContent = `⚔️ Duel 1v1 : Vous vs ${data.rivalName || 'Joueur 2'}`;
    matchStatusBadge.style.borderColor = '#00d2ff';
    matchStatusBadge.style.color = '#00d2ff';
    rivalNameElem.textContent = data.rivalName || 'Joueur 2';
  } else {
    matchStatusBadge.textContent = '🎮 Solo vs 🤖 BlastBot';
    matchStatusBadge.style.borderColor = '#f59e0b';
    matchStatusBadge.style.color = '#f59e0b';
    rivalNameElem.textContent = '🤖 BlastBot';
  }
}

// Quitter proprement la session
function leaveBrickGame() {
  try {
    socket.emit('brick_leave');
    socket.disconnect();
  } catch (e) {}
}

if (btnHubExit) btnHubExit.addEventListener('click', leaveBrickGame);
document.querySelectorAll('a[href="/"]').forEach(link => link.addEventListener('click', leaveBrickGame));
window.addEventListener('pagehide', leaveBrickGame);
window.addEventListener('beforeunload', leaveBrickGame);

// Initialiser les briques
function initBricks() {
  bricks = [];
  const palette = ['#ff007f', '#00d2ff', '#f59e0b', '#10b981', '#9d4edd', '#ff9f1c'];

  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      const bx = BRICK_OFFSET_LEFT + c * (BRICK_W + BRICK_PADDING);
      const by = BRICK_OFFSET_TOP + r * (BRICK_H + BRICK_PADDING);

      // Types spéciaux : 15% TNT, 15% Powerup, 20% Hard (2 PV), 50% Normal
      const rand = Math.random();
      let type = 'normal';
      let hp = 1;
      let color = palette[r % palette.length];

      if (rand < 0.12) {
        type = 'tnt'; // 💣 Brique Explosive Blast
        color = '#ef4444';
      } else if (rand < 0.26) {
        type = 'powerup'; // ⭐ Brique Bonus
        color = '#facc15';
      } else if (rand < 0.45 && r < 3) {
        type = 'hard'; // 🛡️ Brique Renforcée (2 PV)
        hp = 2;
        color = '#8b5cf6';
      }

      bricks.push({
        id: `${r}_${c}`,
        x: bx,
        y: by,
        width: BRICK_W,
        height: BRICK_H,
        type: type,
        hp: hp,
        maxHp: hp,
        color: color
      });
    }
  }
}

// Réinitialiser la balle sur la raquette
function resetBallOnPaddle() {
  balls = [{
    x: paddle.x + paddle.width / 2,
    y: paddle.y - 8,
    vx: 0,
    vy: 0,
    radius: 7,
    speed: 7.2,
    stuck: true
  }];
  startPrompt.classList.remove('hidden');
}

// Lancer la balle
function launchBall() {
  initAudio();
  balls.forEach(b => {
    if (b.stuck) {
      b.stuck = false;
      const angle = (Math.random() * 0.5 - 0.25) - Math.PI / 2; // Direction vers le haut
      b.vx = Math.cos(angle) * b.speed;
      b.vy = Math.sin(angle) * b.speed;
    }
  });
  startPrompt.classList.add('hidden');

  // Tirer les lasers si le bonus est actif
  if (paddle.hasLaser) {
    fireLasers();
  }
}

function fireLasers() {
  lasers.push({ x: paddle.x + 12, y: paddle.y - 4, vy: -12 });
  lasers.push({ x: paddle.x + paddle.width - 12, y: paddle.y - 4, vy: -12 });
  playBrickSound('laser');
}

// Démarrer une nouvelle manche
function initGame() {
  score = 0;
  lives = 3;
  combo = 0;
  isGameOver = false;
  powerups = [];
  lasers = [];
  particles = [];
  paddle.width = paddle.baseWidth;
  paddle.isWide = false;
  paddle.hasLaser = false;
  paddle.hasFireball = false;

  updateHUD();
  initBricks();
  resetBallOnPaddle();
  gameOverlay.classList.add('hidden');
}

function updateHUD() {
  playerScoreElem.textContent = score;
  playerComboElem.textContent = combo > 1 ? `COMBO x${combo} 🔥` : `COMBO x1`;
  let hearts = '';
  for (let i = 0; i < lives; i++) hearts += '❤️';
  playerLivesElem.textContent = hearts || '💀';

  // Synchronisation avec le serveur
  socket.emit('brick_progress', {
    score: score,
    lives: lives,
    bricksLeft: bricks.filter(b => b.hp > 0).length
  });
}

// Entrées Clavier
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'q' || k === 'a') keys.left = true;
  if (k === 'arrowright' || k === 'd') keys.right = true;
  if (e.code === 'Space') {
    e.preventDefault();
    launchBall();
  }
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'q' || k === 'a') keys.left = false;
  if (k === 'arrowright' || k === 'd') keys.right = false;
});

// Suivi Souris
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, mouseX - paddle.width / 2));
  mouseControl = true;
});

canvas.addEventListener('click', launchBall);

// Contrôles Tactiles Mobiles
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length > 0) {
    const rect = canvas.getBoundingClientRect();
    const touchX = (e.touches[0].clientX - rect.left) * (canvas.width / rect.width);
    paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, touchX - paddle.width / 2));
  }
}, { passive: false });

canvas.addEventListener('touchstart', (e) => {
  launchBall();
});

btnTouchAction.addEventListener('touchstart', (e) => {
  e.preventDefault();
  launchBall();
}, { passive: false });

btnRestart.addEventListener('click', initGame);

btnToggleSound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  btnToggleSound.textContent = soundEnabled ? '🔊 Son' : '🔇 Muet';
});

// Audio Web Audio API
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
}

function playBrickSound(type, noteFreq = 440) {
  if (!soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;

  if (type === 'hit_brick') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(noteFreq, now);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } else if (type === 'hit_paddle') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } else if (type === 'blast') {
    // 💣 Son d'explosion TNT Blast
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  } else if (type === 'powerup') {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const st = now + i * 0.06;
      osc.frequency.setValueAtTime(f, st);
      gain.gain.setValueAtTime(0.14, st);
      gain.gain.exponentialRampToValueAtTime(0.01, st + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(st);
      osc.stop(st + 0.11);
    });
  } else if (type === 'laser') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.07);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }
}

// Déclencher une explosion TNT (BLAST !)
function triggerTntBlast(tntBrick) {
  playBrickSound('blast');

  // Secousse d'écran
  triggerScreenShake();

  // Particules d'explosion
  createBlastParticles(tntBrick.x + tntBrick.width / 2, tntBrick.y + tntBrick.height / 2);

  // Détruire toutes les briques voisines (dans un rayon de 110px)
  const blastRadius = 110;
  bricks.forEach(b => {
    if (b.hp <= 0) return;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const dist = Math.hypot(cx - (tntBrick.x + tntBrick.width / 2), cy - (tntBrick.y + tntBrick.height / 2));

    if (dist < blastRadius) {
      b.hp = 0;
      score += 200 * Math.max(1, combo);
      createBrickDebris(b);
    }
  });

  updateHUD();
}

let screenShake = 0;
function triggerScreenShake() {
  screenShake = 12;
}

// Boucle principale de jeu
function updateGame() {
  if (isGameOver) return;
  const now = Date.now();

  // 1. Déplacement clavier de la raquette
  if (keys.left) paddle.x = Math.max(0, paddle.x - paddle.speed);
  if (keys.right) paddle.x = Math.min(canvas.width - paddle.width, paddle.x + paddle.speed);

  // Expiration des bonus
  if (paddle.isWide && now > paddle.wideExpires) {
    paddle.isWide = false;
    paddle.width = paddle.baseWidth;
  }
  if (paddle.hasLaser && now > paddle.laserExpires) {
    paddle.hasLaser = false;
  }
  if (paddle.hasFireball && now > paddle.fireballExpires) {
    paddle.hasFireball = false;
  }

  // Timer de combo
  if (combo > 0 && now > comboTimer) {
    combo = 0;
    updateHUD();
  }

  // 2. Déplacement des balles
  for (let i = balls.length - 1; i >= 0; i--) {
    const ball = balls[i];

    if (ball.stuck) {
      ball.x = paddle.x + paddle.width / 2;
      ball.y = paddle.y - ball.radius;
      continue;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Rebond sur les murs latéraux
    if (ball.x - ball.radius <= 0) {
      ball.x = ball.radius;
      ball.vx = -ball.vx;
      playBrickSound('hit_paddle');
    } else if (ball.x + ball.radius >= canvas.width) {
      ball.x = canvas.width - ball.radius;
      ball.vx = -ball.vx;
      playBrickSound('hit_paddle');
    }

    // Rebond sur le plafond
    if (ball.y - ball.radius <= 0) {
      ball.y = ball.radius;
      ball.vy = -ball.vy;
      playBrickSound('hit_paddle');
    }

    // Rebond sur la raquette
    if (ball.vy > 0 &&
        ball.y + ball.radius >= paddle.y &&
        ball.y - ball.radius <= paddle.y + paddle.height &&
        ball.x >= paddle.x - 4 &&
        ball.x <= paddle.x + paddle.width + 4) {

      // Angle de rebond calculé selon l'impact sur la raquette
      const hitOffset = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
      const angle = hitOffset * (Math.PI / 3); // Max 60 deg
      const speed = Math.min(11.5, Math.hypot(ball.vx, ball.vy) + 0.15);

      ball.vx = speed * Math.sin(angle);
      ball.vy = -speed * Math.cos(angle);
      ball.y = paddle.y - ball.radius;

      playBrickSound('hit_paddle');
    }

    // Balle perdue en bas
    if (ball.y - ball.radius > canvas.height) {
      balls.splice(i, 1);
    }
  }

  // Si toutes les balles sont perdues
  if (balls.length === 0) {
    lives--;
    combo = 0;
    updateHUD();

    if (lives <= 0) {
      endGame(false, 'Vous avez perdu toutes vos vies !');
      return;
    } else {
      resetBallOnPaddle();
    }
  }

  // 3. Déplacement des lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    const l = lasers[i];
    l.y += l.vy;

    let hit = false;
    for (const b of bricks) {
      if (b.hp <= 0) return;
      if (l.x >= b.x && l.x <= b.x + b.width && l.y >= b.y && l.y <= b.y + b.height) {
        b.hp--;
        hit = true;
        if (b.hp <= 0) {
          handleBrickDestroyed(b);
        }
        break;
      }
    }

    if (hit || l.y < 0) {
      lasers.splice(i, 1);
    }
  }

  // 4. Déplacement des bonus qui tombent
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.y += p.vy;

    // Ramassage par la raquette
    if (p.y + p.radius >= paddle.y &&
        p.y - p.radius <= paddle.y + paddle.height &&
        p.x >= paddle.x &&
        p.x <= paddle.x + paddle.width) {

      applyPowerup(p.type);
      playBrickSound('powerup');
      powerups.splice(i, 1);
      continue;
    }

    if (p.y > canvas.height) {
      powerups.splice(i, 1);
    }
  }

  // 5. Collisions Balle vs Briques
  for (const ball of balls) {
    if (ball.stuck) continue;

    for (const b of bricks) {
      if (b.hp <= 0) continue;

      if (ball.x + ball.radius >= b.x &&
          ball.x - ball.radius <= b.x + b.width &&
          ball.y + ball.radius >= b.y &&
          ball.y - ball.radius <= b.y + b.height) {

        // Dégâts sur la brique
        b.hp--;

        // Combo pitch audio
        combo++;
        comboTimer = now + 1800;
        const noteFreq = 380 + Math.min(12, combo) * 35;
        playBrickSound('hit_brick', noteFreq);

        score += (b.maxHp > 1 ? 150 : 100) * Math.max(1, combo);
        createBrickDebris(b);

        if (b.hp <= 0) {
          handleBrickDestroyed(b);
        }

        // Si la boule de feu est active, elle transperce sans rebondir !
        if (!paddle.hasFireball) {
          // Calcul de la normale de collision pour le rebond
          const prevX = ball.x - ball.vx;
          const prevY = ball.y - ball.vy;

          if (prevX < b.x || prevX > b.x + b.width) {
            ball.vx = -ball.vx;
          } else {
            ball.vy = -ball.vy;
          }
        }
        updateHUD();
        break; // Une brique par tick par balle
      }
    }
  }

  // 6. Vérifier si toutes les briques sont détruites (Victoire !)
  const remaining = bricks.filter(b => b.hp > 0).length;
  if (remaining === 0) {
    endGame(true, 'Incroyable ! Vous avez anéanti toutes les briques !');
  }
}

function handleBrickDestroyed(b) {
  if (b.type === 'tnt') {
    triggerTntBlast(b);
  } else if (b.type === 'powerup') {
    const types = ['multiball', 'laser', 'wide', 'fireball'];
    const pType = types[Math.floor(Math.random() * types.length)];
    powerups.push({
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
      vy: 2.3,
      radius: 12,
      type: pType
    });
  }
}

function applyPowerup(type) {
  const now = Date.now();
  if (type === 'multiball') {
    // Tripler les balles existantes
    const newBalls = [];
    balls.forEach(b => {
      newBalls.push({
        ...b,
        vx: b.vx * 0.8 + 2.5,
        vy: b.vy
      });
      newBalls.push({
        ...b,
        vx: b.vx * 0.8 - 2.5,
        vy: b.vy
      });
    });
    balls.push(...newBalls);
  } else if (type === 'wide') {
    paddle.isWide = true;
    paddle.width = paddle.baseWidth * 1.6;
    paddle.wideExpires = now + 12000;
  } else if (type === 'laser') {
    paddle.hasLaser = true;
    paddle.laserExpires = now + 10000;
  } else if (type === 'fireball') {
    paddle.hasFireball = true;
    paddle.fireballExpires = now + 8000;
  }
}

function createBrickDebris(b) {
  for (let i = 0; i < 8; i++) {
    particles.push({
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      color: b.color,
      size: 4 + Math.random() * 3,
      life: 1.0,
      decay: 0.04
    });
  }
}

function createBlastParticles(x, y) {
  for (let i = 0; i < 35; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 12;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      color: Math.random() > 0.4 ? '#ef4444' : '#f59e0b',
      size: 6 + Math.random() * 6,
      life: 1.0,
      decay: 0.025
    });
  }
}

function endGame(won, subtitle) {
  isGameOver = true;
  gameOverlay.classList.remove('hidden');
  overlayTitle.textContent = won ? 'VICTOIRE ! 🏆' : 'DÉFAITE 💥';
  overlayTitle.style.color = won ? '#f59e0b' : '#ef4444';
  overlaySubtitle.textContent = subtitle;
  finalScoreElem.textContent = score;

  socket.emit('brick_game_over', { won: won, score: score });
}

// Rendu Graphique (60 FPS)
function render() {
  requestAnimationFrame(render);
  updateGame();

  ctx.save();

  // Secousse d'écran lors des explosions
  if (screenShake > 0) {
    const dx = (Math.random() - 0.5) * screenShake;
    const dy = (Math.random() - 0.5) * screenShake;
    ctx.translate(dx, dy);
    screenShake *= 0.88;
    if (screenShake < 0.5) screenShake = 0;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fond d'arène néon sombre avec grille
  ctx.fillStyle = '#090d14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  // 1. Dessiner les briques
  bricks.forEach(b => {
    if (b.hp <= 0) return;

    ctx.save();
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = b.type === 'tnt' ? 14 : 8;

    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.width, b.height, 4);
    ctx.fill();

    // Bordure
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Icône ou PV
    if (b.type === 'tnt') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💣', b.x + b.width / 2, b.y + b.height / 2);
    } else if (b.type === 'powerup') {
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', b.x + b.width / 2, b.y + b.height / 2);
    } else if (b.type === 'hard') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.hp, b.x + b.width / 2, b.y + b.height / 2);
    }
    ctx.restore();
  });

  // 2. Dessiner les capsules de bonus
  powerups.forEach(p => {
    ctx.save();
    ctx.fillStyle = p.type === 'fireball' ? '#ff007f' : (p.type === 'laser' ? '#ef4444' : '#00d2ff');
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = p.type === 'multiball' ? '⚡' : (p.type === 'laser' ? '🔫' : (p.type === 'fireball' ? '🔥' : '📏'));
    ctx.fillText(icon, p.x, p.y);
  });

  // 3. Dessiner les tirs lasers
  lasers.forEach(l => {
    ctx.save();
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 10;
    ctx.fillRect(l.x - 2, l.y, 4, 14);
    ctx.restore();
  });

  // 4. Dessiner les particules
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.life -= pt.decay;

    if (pt.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, pt.life);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5. Dessiner la raquette / canon
  ctx.save();
  const padColor = paddle.hasFireball ? '#ff007f' : (paddle.hasLaser ? '#ef4444' : '#f59e0b');
  ctx.fillStyle = padColor;
  ctx.shadowColor = padColor;
  ctx.shadowBlur = 14;

  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, 6);
  ctx.fill();

  // Canons lasers sur les côtés
  if (paddle.hasLaser) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(paddle.x + 8, paddle.y - 6, 8, 8);
    ctx.fillRect(paddle.x + paddle.width - 16, paddle.y - 6, 8, 8);
  }
  ctx.restore();

  // 6. Dessiner les balles
  balls.forEach(ball => {
    ctx.save();
    const ballColor = paddle.hasFireball ? '#ff007f' : '#ffffff';
    ctx.fillStyle = ballColor;
    ctx.shadowColor = paddle.hasFireball ? '#ff007f' : '#f59e0b';
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  ctx.restore();
}

initGame();
requestAnimationFrame(render);
