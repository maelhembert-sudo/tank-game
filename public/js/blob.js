// ==========================================
// CLIENT BLOB CLASH (AGAR.IO MULTIJOUEUR)
// ==========================================
const socket = io({
  transports: ['websocket', 'polling']
});

const canvas = document.getElementById('blobCanvas');
const ctx = canvas.getContext('2d');

// Éléments du DOM
const lobbyScreen = document.getElementById('blob-lobby-screen');
const hud = document.getElementById('blob-hud');
const deathOverlay = document.getElementById('death-overlay');
const btnStart = document.getElementById('btn-start');
const btnRespawn = document.getElementById('btn-respawn');
const playerNameInput = document.getElementById('player-name');
const colorButtons = document.querySelectorAll('.color-btn');
const blobMassVal = document.getElementById('blob-mass-val');
const leaderboardList = document.getElementById('leaderboard-list');
const feedContainer = document.getElementById('feed-container');
const deathKillerText = document.getElementById('death-killer-text');
const deathMaxMass = document.getElementById('death-max-mass');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnTouchSplit = document.getElementById('btn-touch-split');
const btnTouchEject = document.getElementById('btn-touch-eject');
const btnHubExit = document.getElementById('btn-hub-exit');

let selectedColor = '#10b981';
let myId = null;
let soundEnabled = true;
let isPlaying = false;
let maxMassReached = 20;

// Configuration de la carte reçue du serveur
let mapConfig = { width: 3000, height: 3000 };

// État local du jeu
let foodPellets = new Map(); // id -> { id, x, y, color, radius }
let ejectedPellets = [];
let viruses = [];
let players = {};
let myCells = [];

// Position de la caméra et curseur
const camera = { x: 1500, y: 1500, zoom: 1.0 };
let mouseScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let isTouching = false;

// Redimensionnement du Canvas
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

// Démarrer la partie
btnStart.addEventListener('click', startGame);
btnRespawn.addEventListener('click', startGame);

function startGame() {
  initAudio();
  const name = playerNameInput.value.trim() || 'Cellule';
  socket.emit('blob_join', { name, color: selectedColor });
  lobbyScreen.classList.add('hidden');
  deathOverlay.classList.add('hidden');
  hud.classList.remove('hidden');
  isPlaying = true;
  maxMassReached = 20;
}

// Quitter proprement la session
function leaveBlobGame() {
  try {
    socket.emit('blob_leave');
    socket.disconnect();
  } catch (e) {}
}

if (btnHubExit) {
  btnHubExit.addEventListener('click', leaveBlobGame);
}
document.querySelectorAll('a[href="/"]').forEach(link => {
  link.addEventListener('click', leaveBlobGame);
});
window.addEventListener('pagehide', leaveBlobGame);
window.addEventListener('beforeunload', leaveBlobGame);

// Toggle Son
btnToggleSound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  btnToggleSound.textContent = soundEnabled ? '🔊 Son' : '🔇 Muet';
});

// Événements Réseau
socket.on('blob_init', (data) => {
  myId = data.myId;
  mapConfig = data.map;
  viruses = data.viruses || [];
  foodPellets.clear();
  if (data.food) {
    data.food.forEach(f => foodPellets.set(f.id, f));
  }
});

socket.on('blob_food_sync', (data) => {
  if (data.eaten) {
    data.eaten.forEach(id => foodPellets.delete(id));
  }
  if (data.added) {
    data.added.forEach(f => foodPellets.set(f.id, f));
  }
});

socket.on('blob_state', (state) => {
  players = state.players;
  ejectedPellets = state.ejected || [];

  const me = players[myId];
  if (me && me.isAlive && me.cells && me.cells.length > 0) {
    myCells = me.cells;
    const totalMass = myCells.reduce((sum, c) => sum + c.mass, 0);
    blobMassVal.textContent = Math.round(totalMass);
    if (totalMass > maxMassReached) maxMassReached = Math.round(totalMass);
  } else if (isPlaying && me && !me.isAlive) {
    // Mort du joueur
    isPlaying = false;
    deathKillerText.textContent = me.killedBy 
      ? `Vous avez été dévoré par ${me.killedBy} !` 
      : `Vous avez été absorbé par un prédateur géant.`;
    deathMaxMass.textContent = maxMassReached;
    deathOverlay.classList.remove('hidden');
  }

  updateLeaderboard(state.leaderboard || []);
});

socket.on('blob_feed', (msg) => {
  addFeedItem(msg);
});

socket.on('blob_sound', (type) => {
  playBlobSound(type);
});

// Mise à jour du classement
function updateLeaderboard(list) {
  leaderboardList.innerHTML = '';
  list.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-item' + (item.id === myId ? ' is-me' : '');
    row.innerHTML = `<span>${index + 1}. ${escapeHtml(item.name)}</span><span>${Math.round(item.mass)}</span>`;
    leaderboardList.appendChild(row);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addFeedItem(text) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.textContent = text;
  feedContainer.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// Suivi Souris & Tactile
window.addEventListener('mousemove', (e) => {
  mouseScreen.x = e.clientX;
  mouseScreen.y = e.clientY;
});

window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    mouseScreen.x = e.touches[0].clientX;
    mouseScreen.y = e.touches[0].clientY;
  }
}, { passive: true });

// Actions Clavier
window.addEventListener('keydown', (e) => {
  if (!isPlaying) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space' || k === ' ') {
    e.preventDefault();
    socket.emit('blob_split');
  } else if (k === 'w' || k === 'z') {
    socket.emit('blob_eject');
  }
});

// Boutons Tactiles
btnTouchSplit.addEventListener('touchstart', (e) => {
  e.preventDefault();
  socket.emit('blob_split');
}, { passive: false });

btnTouchEject.addEventListener('touchstart', (e) => {
  e.preventDefault();
  socket.emit('blob_eject');
}, { passive: false });

// Envoi périodique de la cible (25 Hz)
setInterval(() => {
  if (!isPlaying) return;
  // Convertir coordonnées écran en coordonnées monde
  const worldX = (mouseScreen.x - canvas.width / 2) / camera.zoom + camera.x;
  const worldY = (mouseScreen.y - canvas.height / 2) / camera.zoom + camera.y;
  socket.emit('blob_target', { x: worldX, y: worldY });
}, 1000 / 25);

// Audio Web Audio API
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
}

function playBlobSound(type) {
  if (!soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;

  if (type === 'eat') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.05);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } else if (type === 'split') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.12);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } else if (type === 'absorbed') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.25);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  }
}

// Boucle de rendu graphique 60 FPS
function renderBlob() {
  requestAnimationFrame(renderBlob);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Mise à jour de la caméra sur le centre de masse du joueur
  if (myCells.length > 0) {
    let centerX = 0, centerY = 0, totalRadius = 0;
    myCells.forEach(c => {
      centerX += c.x;
      centerY += c.y;
      totalRadius += c.radius;
    });
    centerX /= myCells.length;
    centerY /= myCells.length;

    camera.x += (centerX - camera.x) * 0.1;
    camera.y += (centerY - camera.y) * 0.1;

    // Zoom dynamique : plus la cellule est grosse, plus on dézoome
    const targetZoom = Math.max(0.42, Math.min(1.0, 1.0 - (totalRadius - 24) * 0.0016));
    camera.zoom += (targetZoom - camera.zoom) * 0.05;
  }

  ctx.save();
  // Centrer et appliquer zoom
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // 2. Fond de la carte avec grille
  const viewLeft = camera.x - (canvas.width / 2) / camera.zoom;
  const viewTop = camera.y - (canvas.height / 2) / camera.zoom;
  const viewRight = camera.x + (canvas.width / 2) / camera.zoom;
  const viewBottom = camera.y + (canvas.height / 2) / camera.zoom;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.lineWidth = 1;
  const gridSize = 50;
  const startX = Math.floor(Math.max(0, viewLeft) / gridSize) * gridSize;
  const endX = Math.min(mapConfig.width, viewRight);
  const startY = Math.floor(Math.max(0, viewTop) / gridSize) * gridSize;
  const endY = Math.min(mapConfig.height, viewBottom);

  ctx.beginPath();
  for (let x = startX; x <= endX; x += gridSize) {
    ctx.moveTo(x, Math.max(0, viewTop));
    ctx.lineTo(x, Math.min(mapConfig.height, viewBottom));
  }
  for (let y = startY; y <= endY; y += gridSize) {
    ctx.moveTo(Math.max(0, viewLeft), y);
    ctx.lineTo(Math.min(mapConfig.width, viewRight), y);
  }
  ctx.stroke();

  // Bords de l'arène
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, mapConfig.width, mapConfig.height);

  // 3. Orbes de nourriture (Food)
  foodPellets.forEach(f => {
    if (f.x + f.radius < viewLeft || f.x - f.radius > viewRight ||
        f.y + f.radius < viewTop || f.y - f.radius > viewBottom) return;

    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.fill();
  });

  // 4. Pastilles éjectées (W)
  ejectedPellets.forEach(p => {
    ctx.fillStyle = p.color || '#10b981';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius || 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // 5. Virus (Obstacles piquants verts)
  viruses.forEach(v => {
    drawVirus(v.x, v.y, v.radius);
  });

  // 6. Cellules des Joueurs & Bots (triées par rayon pour les superpositions)
  const allCellsToDraw = [];
  for (const id in players) {
    const p = players[id];
    if (!p.isAlive || !p.cells) continue;
    p.cells.forEach(c => {
      allCellsToDraw.push({
        ...c,
        playerId: p.id,
        name: p.name,
        color: p.color,
        isMe: p.id === myId
      });
    });
  }
  allCellsToDraw.sort((a, b) => a.radius - b.radius);

  allCellsToDraw.forEach(cell => {
    drawCell(cell);
  });

  ctx.restore();
}

// Dessin d'une cellule avec contour néon et pseudo
function drawCell(cell) {
  ctx.save();

  // Halo lumineux pour les cellules du joueur
  if (cell.isMe) {
    ctx.shadowColor = cell.color;
    ctx.shadowBlur = 18;
  }

  // Corps de la cellule
  ctx.fillStyle = cell.color;
  ctx.beginPath();
  ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
  ctx.fill();

  // Bordure foncée légèrement transparente
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = Math.max(2, cell.radius * 0.06);
  ctx.stroke();
  ctx.restore();

  // Pseudo et masse au centre
  ctx.save();
  const fontSize = Math.max(11, Math.min(24, cell.radius * 0.32));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 4;

  ctx.fillText(cell.name, cell.x, cell.y - (cell.radius > 25 ? fontSize * 0.35 : 0));

  if (cell.radius > 25) {
    ctx.font = `bold ${fontSize * 0.75}px sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(Math.round(cell.mass), cell.x, cell.y + fontSize * 0.7);
  }
  ctx.restore();
}

// Dessin d'un virus spiky
function drawVirus(x, y, radius) {
  ctx.save();
  ctx.fillStyle = '#22c55e';
  ctx.strokeStyle = '#15803d';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#22c55e';
  ctx.shadowBlur = 10;

  const spikes = 18;
  const outerR = radius;
  const innerR = radius - 5;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = (i % 2 === 0) ? outerR : innerR;
    const a = (i * Math.PI) / spikes;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

requestAnimationFrame(renderBlob);

