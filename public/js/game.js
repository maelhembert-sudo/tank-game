// Configuration et variables globales
const socket = io({
  transports: ['websocket', 'polling']
});
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myId = null;
let mapConfig = { width: 1800, height: 1200, walls: [] };
let players = {};
let bullets = [];
let powerups = [];
let particles = [];
let soundEnabled = true;

// Entrées utilisateur
const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  turretAngle: 0,
  shoot: false
};

// Caméra du joueur
const camera = { x: 0, y: 0 };
let mouseScreenPos = { x: 0, y: 0 };

// Éléments du DOM
const lobbyScreen = document.getElementById('lobby-screen');
const gameHud = document.getElementById('game-hud');
const deathOverlay = document.getElementById('death-overlay');
const respawnCounter = document.getElementById('respawn-counter');
const touchControls = document.getElementById('touch-controls');
const btnStart = document.getElementById('btn-start');
const playerNameInput = document.getElementById('player-name');
const colorButtons = document.querySelectorAll('.color-btn');
const hudHealthFill = document.getElementById('hud-health-fill');
const hudHealthText = document.getElementById('hud-health-text');
const hudName = document.getElementById('hud-name');
const hudBuffs = document.getElementById('hud-buffs');
const leaderboardList = document.getElementById('leaderboard-list');
const killFeed = document.getElementById('kill-feed');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const lanUrlText = document.getElementById('lan-url-text');

let selectedColor = '#e52d27';

// Initialisation du Canvas
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Choix de la couleur
colorButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    colorButtons.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedColor = btn.dataset.color;
  });
});

// Détection de l'adresse du serveur pour le message LAN
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  lanUrlText.innerHTML = `Connecté sur <b>http://${window.location.host}</b>`;
} else {
  lanUrlText.innerHTML = `Invitez vos amis en leur donnant : <b>http://${window.location.hostname}:${window.location.port || 3000}</b> (ou l'IP locale affichée dans le terminal)`;
}

// Détection mobile pour afficher les touches virtuelles
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouchDevice) {
  touchControls.classList.remove('hidden');
}

// Démarrage de la partie
btnStart.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Tankiste';
  socket.emit('join_game', { name, color: selectedColor });
  lobbyScreen.classList.add('hidden');
  gameHud.classList.remove('hidden');
  hudName.textContent = name;
  initAudio();
});

// Toggle Son
btnToggleSound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  btnToggleSound.textContent = soundEnabled ? '🔊' : '🔇';
});

// Réception de la configuration de carte
socket.on('init_map', (data) => {
  mapConfig = data;
});

// Réception de l'ID du joueur local
socket.on('joined', (data) => {
  myId = data.id;
});

// Fonctions de lissage et d'interpolation (LERP) pour éliminer les saccades réseau
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

function checkRectCircle(rect, cx, cy, radius) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < (radius * radius);
}

// Réception de l'état du jeu (60 Hz parfaitement synchronisé)
socket.on('game_state', (state) => {
  const activeIds = new Set();

  for (const id in state.players) {
    activeIds.add(id);
    const sp = state.players[id];

    if (!players[id]) {
      // Nouveau joueur connecté
      players[id] = {
        ...sp,
        x: sp.x,
        y: sp.y,
        bodyAngle: sp.bodyAngle,
        targetX: sp.x,
        targetY: sp.y,
        targetAngle: sp.bodyAngle
      };
    } else {
      const p = players[id];
      Object.assign(p, sp);
      p.targetX = sp.x;
      p.targetY = sp.y;
      p.targetAngle = sp.bodyAngle;

      // Téléportation uniquement en cas de respawn (distance > 250px)
      const dist = Math.hypot(p.targetX - p.x, p.targetY - p.y);
      if (dist > 250 || !sp.isAlive) {
        p.x = p.targetX;
        p.y = p.targetY;
        p.bodyAngle = p.targetAngle;
      }
    }
  }

  // Nettoyage des joueurs déconnectés
  for (const id in players) {
    if (!activeIds.has(id)) {
      delete players[id];
    }
  }

  // Synchronisation des projectiles et bonus
  bullets = state.bullets;
  powerups = state.powerups;

  // Création d'effets de particules d'explosion
  if (state.explosions && state.explosions.length > 0) {
    state.explosions.forEach(exp => {
      createExplosionParticles(exp.x, exp.y, exp.radius, exp.type);
    });
  }

  updateHUD();
});

// Événements de son reçus du serveur
socket.on('sound_event', (evt) => {
  playSound(evt.type);
});

// Messages de kill / chat
socket.on('chat_message', (msg) => {
  addKillFeedMessage(msg.text, msg.color);
});

function addKillFeedMessage(text, color = '#ff416c') {
  const item = document.createElement('div');
  item.className = 'kill-message';
  item.style.borderLeftColor = color;
  item.textContent = text;
  killFeed.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transition = 'opacity 0.5s';
    setTimeout(() => item.remove(), 500);
  }, 4500);
}

// Mise à jour de l'affichage HUD
function updateHUD() {
  const me = players[myId];
  if (!me) return;

  // Santé
  const hpPercent = Math.max(0, (me.health / me.maxHealth) * 100);
  hudHealthFill.style.width = `${hpPercent}%`;
  hudHealthText.textContent = `${Math.max(0, Math.ceil(me.health))} / ${me.maxHealth}`;

  // Buffs
  const now = Date.now();
  let buffHtml = '';
  if (me.hasShield || (me.shieldTime && now < me.shieldTime)) {
    buffHtml += `<span class="buff-pill" style="background:#00d2ff;">🛡️ Bouclier Actif</span>`;
  }
  if (now < me.rapidFireUntil) {
    buffHtml += `<span class="buff-pill" style="background:#ffb300;">⚡ Tir Rapide (${Math.ceil((me.rapidFireUntil - now)/1000)}s)</span>`;
  }
  if (now < me.tripleShotUntil) {
    buffHtml += `<span class="buff-pill" style="background:#ff007f;">💥 Triple Tir (${Math.ceil((me.tripleShotUntil - now)/1000)}s)</span>`;
  }
  if (me.speedMultiplier > 1.0) {
    buffHtml += `<span class="buff-pill" style="background:#38ef7d;">💨 Vitesse</span>`;
  }
  hudBuffs.innerHTML = buffHtml;

  // Mort / Respawn
  if (!me.isAlive) {
    deathOverlay.classList.remove('hidden');
    const remaining = Math.max(0, Math.ceil((me.respawnAt - now) / 1000));
    respawnCounter.textContent = remaining;
  } else {
    deathOverlay.classList.add('hidden');
  }

  // Classement
  const sorted = Object.values(players).sort((a, b) => b.kills - a.kills || b.score - a.score);
  leaderboardList.innerHTML = sorted.slice(0, 6).map((p, idx) => `
    <div class="leaderboard-row ${p.id === myId ? 'me' : ''}">
      <span>#${idx + 1} ${p.name}</span>
      <span>${p.kills} 🎯</span>
    </div>
  `).join('');
}

// Synthétiseur Audio Web Audio API (100% autonome et sans dépendances)
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
}

function playSound(type) {
  if (!soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  if (type === 'shoot') {
    // Son de tir (coup de canon avec chute de fréquence)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } else if (type === 'ricochet') {
    // Ricochet métallique aigu
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'hit') {
    // Impact sur blindage
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.18);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  } else if (type === 'tank_destroyed') {
    // Explosion massive avec bruit blanc
    const bufferSize = audioCtx.sampleRate * 0.5;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(50, now + 0.45);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.48);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(now);
  } else if (type === 'shield_broken') {
    // Son d'explosion / éclatement de bouclier
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.26);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.26);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.27);
  } else if (type === 'powerup') {
    // Carillon de powerup montant
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = now + idx * 0.06;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.11);
    });
  }
}

// Gestion des Particules
function createExplosionParticles(x, y, radius, type) {
  const count = type === 'tank' ? 45 : (type === 'shield_break' ? 28 : 16);
  const colors = type === 'shield_break'
    ? ['#00f0ff', '#ffffff', '#00b4d8', '#caf0f8']
    : ['#ff4b2b', '#ff416c', '#ffb300', '#ffffff'];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 4 + 1.5) * (type === 'tank' ? 1.8 : 1.3);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 5 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1.0,
      decay: Math.random() * 0.03 + 0.02
    });
  }
}

// Entrées Clavier & Souris (optimisées sans spam réseau)
window.addEventListener('keydown', (e) => {
  if (e.repeat) return; // Évite d'envoyer 50 paquets/seconde par touche enfoncée
  const key = e.key.toLowerCase();
  let changed = false;

  if ((key === 'z' || key === 'w' || key === 'arrowup') && !inputState.forward) {
    inputState.forward = true;
    changed = true;
  }
  if ((key === 's' || key === 'arrowdown') && !inputState.backward) {
    inputState.backward = true;
    changed = true;
  }
  if ((key === 'q' || key === 'a' || key === 'arrowleft') && !inputState.left) {
    inputState.left = true;
    changed = true;
  }
  if ((key === 'd' || key === 'arrowright') && !inputState.right) {
    inputState.right = true;
    changed = true;
  }
  if (key === ' ' && !inputState.shoot) {
    inputState.shoot = true;
    changed = true;
    e.preventDefault();
  }

  if (changed) sendInputs();
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  let changed = false;

  if ((key === 'z' || key === 'w' || key === 'arrowup') && inputState.forward) {
    inputState.forward = false;
    changed = true;
  }
  if ((key === 's' || key === 'arrowdown') && inputState.backward) {
    inputState.backward = false;
    changed = true;
  }
  if ((key === 'q' || key === 'a' || key === 'arrowleft') && inputState.left) {
    inputState.left = false;
    changed = true;
  }
  if ((key === 'd' || key === 'arrowright') && inputState.right) {
    inputState.right = false;
    changed = true;
  }
  if (key === ' ' && inputState.shoot) {
    inputState.shoot = false;
    changed = true;
  }

  if (changed) sendInputs();
});

// Clic souris pour tirer droit devant
window.addEventListener('mousedown', (e) => {
  if (e.target.closest('#lobby-screen') || e.target.closest('.btn-sound')) return;
  inputState.shoot = true;
  sendInputs();
});

window.addEventListener('mouseup', () => {
  inputState.shoot = false;
  sendInputs();
});

function sendInputs() {
  if (!myId || !players[myId]) return;
  socket.emit('player_input', inputState);
}

// Heartbeat régulier pour garantir l'intégrité de l'état sans saturer le réseau (25 Hz)
setInterval(() => {
  if (myId && players[myId]) {
    socket.emit('player_input', inputState);
  }
}, 40);

// Contrôles tactiles (Joysticks virtuels)
setupTouchControls();

function setupTouchControls() {
  const moveZone = document.getElementById('touch-move-zone');
  const moveStick = document.getElementById('touch-move-stick');
  const fireBtn = document.getElementById('touch-fire-btn');

  let moveTouchId = null;
  let moveCenter = { x: 0, y: 0 };

  moveZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    moveTouchId = touch.identifier;
    const rect = moveZone.getBoundingClientRect();
    moveCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    handleMoveTouch(touch);
  }, { passive: false });

  moveZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === moveTouchId) {
        handleMoveTouch(e.changedTouches[i]);
      }
    }
  }, { passive: false });

  function endMoveTouch() {
    moveTouchId = null;
    moveStick.style.transform = `translate(0px, 0px)`;
    inputState.forward = false;
    inputState.backward = false;
    inputState.left = false;
    inputState.right = false;
    sendInputs();
  }

  moveZone.addEventListener('touchend', endMoveTouch);
  moveZone.addEventListener('touchcancel', endMoveTouch);

  function handleMoveTouch(touch) {
    const dx = touch.clientX - moveCenter.x;
    const dy = touch.clientY - moveCenter.y;
    const dist = Math.hypot(dx, dy);
    const maxRadius = 45;
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);

    const stickX = Math.cos(angle) * clampedDist;
    const stickY = Math.sin(angle) * clampedDist;
    moveStick.style.transform = `translate(${stickX}px, ${stickY}px)`;

    // Interpréter la direction
    inputState.forward = dy < -15;
    inputState.backward = dy > 15;
    inputState.left = dx < -15;
    inputState.right = dx > 15;
    sendInputs();
  }

  // Bouton de tir tactile
  fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    inputState.shoot = true;
    sendInputs();
  }, { passive: false });

  fireBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    inputState.shoot = false;
    sendInputs();
  }, { passive: false });
}

let lastFrameTime = performance.now();

// Boucle principale de rendu graphique (Adaptative 60/120/144 FPS)
function gameLoop(currentTime) {
  requestAnimationFrame(gameLoop);

  const deltaMs = currentTime - lastFrameTime;
  lastFrameTime = currentTime;
  // Facteur normalisé (1.0 = ~60 FPS soit 16.6ms)
  const dt = Math.min(2.5, Math.max(0.2, (deltaMs || 16.6) / 16.666));

  // 1. Interpolation ultra-fluide de TOUS les tanks (aucun retour en arrière possible)
  for (const id in players) {
    const p = players[id];
    if (p.targetX !== undefined) {
      const factor = Math.min(1, 0.45 * dt);
      p.x = lerp(p.x, p.targetX, factor);
      p.y = lerp(p.y, p.targetY, factor);
      p.bodyAngle = lerpAngle(p.bodyAngle, p.targetAngle, factor);
    }
  }

  // 2. Extrapolation continue des projectiles entre les ticks réseau
  bullets.forEach(b => {
    b.x += b.vx * (dt * 0.95);
    b.y += b.vy * (dt * 0.95);
  });

  // 3. Suivi fluide de la caméra sur le tank local
  const me = players[myId];
  if (me) {
    const targetCamX = me.x - canvas.width / 2;
    const targetCamY = me.y - canvas.height / 2;
    camera.x += (targetCamX - camera.x) * Math.min(1, 0.2 * dt);
    camera.y += (targetCamY - camera.y) * Math.min(1, 0.2 * dt);
  }

  render();
}
requestAnimationFrame(gameLoop);

function render() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Déplacement relatif à la caméra
  ctx.translate(-camera.x, -camera.y);

  // 1. Dessiner le sol et le quadrillage
  drawGrid();

  // 2. Dessiner les murs
  drawWalls();

  // 3. Dessiner les Power-ups
  drawPowerups();

  // 4. Dessiner les Tanks
  for (const id in players) {
    drawTank(players[id]);
  }

  // 5. Dessiner les Projectiles
  drawBullets();

  // 6. Dessiner les Particules
  drawParticles();

  ctx.restore();
}

// Quadrillage tactique du sol
function drawGrid() {
  ctx.fillStyle = '#0f141d';
  ctx.fillRect(0, 0, mapConfig.width, mapConfig.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.lineWidth = 1;
  const gridSize = 60;

  for (let x = 0; x <= mapConfig.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mapConfig.height);
    ctx.stroke();
  }
  for (let y = 0; y <= mapConfig.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mapConfig.width, y);
    ctx.stroke();
  }
}

// Dessiner les murs de l'arène
function drawWalls() {
  if (!mapConfig.walls) return;
  mapConfig.walls.forEach(w => {
    // Fond du mur métallique
    ctx.fillStyle = '#1e2634';
    ctx.fillRect(w.x, w.y, w.width, w.height);

    // Bordure lumineuse
    ctx.strokeStyle = '#388bfd';
    ctx.lineWidth = 2;
    ctx.strokeRect(w.x, w.y, w.width, w.height);

    // Biseau intérieur
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(w.x + 3, w.y + 3, w.width - 6, w.height - 6);
  });
}

// Dessin d'un Tank
function drawTank(tank) {
  if (!tank.isAlive) return;

  ctx.save();
  ctx.translate(tank.x, tank.y);

  // 1. Ombre portée sous le tank
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(3, 4, tank.width / 2 + 4, tank.height / 2 + 4, tank.bodyAngle, 0, Math.PI * 2);
  ctx.fill();

  // 2. Châssis (corps du tank avec chenilles)
  ctx.save();
  ctx.rotate(tank.bodyAngle);

  // Chenille gauche & droite
  ctx.fillStyle = '#1c1f24';
  ctx.fillRect(-tank.width / 2, -tank.height / 2, tank.width, 7);
  ctx.fillRect(-tank.width / 2, tank.height / 2 - 7, tank.width, 7);

  // Dessin des crans de chenilles
  ctx.fillStyle = '#3a424e';
  for (let cx = -tank.width / 2 + 2; cx < tank.width / 2 - 2; cx += 6) {
    ctx.fillRect(cx, -tank.height / 2, 2, 7);
    ctx.fillRect(cx, tank.height / 2 - 7, 2, 7);
  }

  // Blindage central
  ctx.fillStyle = tank.color;
  ctx.beginPath();
  ctx.roundRect(-tank.width / 2 + 4, -tank.height / 2 + 5, tank.width - 8, tank.height - 10, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();

  // 3. Tourelle et Canon (fixe : toujours alignée avec le châssis)
  ctx.save();
  ctx.rotate(tank.bodyAngle);

  // Canon
  ctx.fillStyle = '#2d333b';
  ctx.fillRect(0, -4, 28, 8);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, -4, 28, 8);

  // Base circulaire de la tourelle
  ctx.fillStyle = '#1c1f24';
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = tank.color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();

  // 4. Bouclier protecteur physique (visible jusqu'à sa destruction !)
  const now = Date.now();
  if (tank.hasShield || (tank.shieldTime && now < tank.shieldTime)) {
    const pulse = Math.sin(now / 110) * 2;
    const r = (tank.radius || 24) + 12 + pulse;

    ctx.save();
    // Halo lumineux externe cyan
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Remplissage d'énergie translucide
    ctx.fillStyle = 'rgba(0, 210, 255, 0.18)';
    ctx.fill();

    // Anneau d'énergie intérieur en rotation
    ctx.rotate(now / 350);
    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 5. Barre de vie et pseudo au-dessus du tank
  ctx.restore(); // retour au repère monde

  // Pseudo
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 4;
  ctx.fillText(tank.name, tank.x, tank.y - 32);
  ctx.shadowBlur = 0;

  // Mini barre de vie
  const barW = 44;
  const barH = 5;
  const barX = tank.x - barW / 2;
  const barY = tank.y - 25;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(barX, barY, barW, barH);
  const hpPct = Math.max(0, tank.health / tank.maxHealth);
  ctx.fillStyle = hpPct > 0.5 ? '#38ef7d' : (hpPct > 0.25 ? '#ffb300' : '#e52d27');
  ctx.fillRect(barX, barY, barW * hpPct, barH);
}

// Dessin des projectiles
function drawBullets() {
  bullets.forEach(b => {
    ctx.save();
    // Halo lumineux
    ctx.fillStyle = b.playerColor || '#ff416c';
    ctx.shadowColor = b.playerColor || '#ff416c';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();

    // Centre blanc chaud
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// Dessin des Powerups
function drawPowerups() {
  const now = Date.now();
  powerups.forEach(p => {
    const pulse = Math.sin(now / 150) * 3;
    ctx.save();
    ctx.translate(p.x, p.y);

    // Aura extérieure
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, p.radius + pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, 0, p.radius * 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Label du Powerup
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText(p.label, 0, -p.radius - 6);
    ctx.restore();
  });
}

// Dessin et mise à jour des particules
function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

