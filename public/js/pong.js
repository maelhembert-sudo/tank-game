// Client Pong 1v1 Multijoueur & vs Bot
const socket = io({
  transports: ['websocket', 'polling']
});

const canvas = document.getElementById('pongCanvas');
const ctx = canvas.getContext('2d');

// Éléments du DOM
const matchStatusBadge = document.getElementById('match-status-badge');
const p1NameElem = document.getElementById('p1-name');
const p1ScoreElem = document.getElementById('p1-score');
const p2NameElem = document.getElementById('p2-name');
const p2ScoreElem = document.getElementById('p2-score');
const pongOverlay = document.getElementById('pong-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySubtitle = document.getElementById('overlay-subtitle');
const btnRestart = document.getElementById('btn-restart');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnTouchUp = document.getElementById('btn-touch-up');
const btnTouchDown = document.getElementById('btn-touch-down');

let myRole = null; // 'p1', 'p2', ou 'spectator'
let soundEnabled = true;

// État local du jeu Pong
let pongState = {
  width: 900,
  height: 550,
  p1: { y: 225, width: 14, height: 100, score: 0, name: 'Joueur 1' },
  p2: { y: 225, width: 14, height: 100, score: 0, name: '🤖 Bot IA', isBot: true },
  ball: { x: 450, y: 275, radius: 9, vx: 5, vy: 3 },
  isGameOver: false,
  winner: null
};

// Traînée lumineuse de la balle
const ballTrail = [];

// Entrées locales
const inputState = { up: false, down: false };

// Rejoindre la salle de Pong
socket.emit('pong_join');

// Rôle assigné par le serveur
socket.on('pong_role', (data) => {
  myRole = data.role; // 'p1', 'p2', ou 'spectator'
  updateRoleBadge();
});

function updateRoleBadge() {
  if (myRole === 'p1') {
    matchStatusBadge.textContent = pongState.p2.isBot ? '🎮 Vous (Joueur 1) vs 🤖 Bot IA' : '⚔️ Match 1v1 : Vous (Joueur 1) vs Joueur 2';
    matchStatusBadge.style.borderColor = '#00d2ff';
    matchStatusBadge.style.color = '#00d2ff';
  } else if (myRole === 'p2') {
    matchStatusBadge.textContent = '⚔️ Match 1v1 : Vous (Joueur 2) vs Joueur 1';
    matchStatusBadge.style.borderColor = '#ff007f';
    matchStatusBadge.style.color = '#ff007f';
  } else {
    matchStatusBadge.textContent = '👁️ Mode Spectateur (Partie 2/2 en cours)';
    matchStatusBadge.style.borderColor = '#8b949e';
    matchStatusBadge.style.color = '#8b949e';
  }
}

// Réception de l'état du Pong (60 Hz)
socket.on('pong_state', (state) => {
  pongState = state;
  updateRoleBadge();

  // Mise à jour des scores
  p1ScoreElem.textContent = state.p1.score;
  p2ScoreElem.textContent = state.p2.score;
  p1NameElem.textContent = state.p1.name + (myRole === 'p1' ? ' (Vous)' : '');
  p2NameElem.textContent = state.p2.name + (myRole === 'p2' ? ' (Vous)' : '');

  // Fin de match
  if (state.isGameOver) {
    pongOverlay.classList.remove('hidden');
    overlayTitle.textContent = `${state.winner} GAGNE ! 🏆`;
    overlaySubtitle.textContent = `Score final : ${state.p1.score} - ${state.p2.score}`;
  } else {
    pongOverlay.classList.add('hidden');
  }

  // Traînée de balle
  ballTrail.push({ x: state.ball.x, y: state.ball.y });
  if (ballTrail.length > 8) ballTrail.shift();
});

// Événements sonores Pong
socket.on('pong_sound', (type) => {
  playPongSound(type);
});

// Bouton Rejouer
btnRestart.addEventListener('click', () => {
  socket.emit('pong_restart');
});

// Toggle Son
btnToggleSound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  btnToggleSound.textContent = soundEnabled ? '🔊 Son' : '🔇 Muet';
});

// Quitter proprement la session Pong
function leavePong() {
  try {
    socket.emit('pong_leave');
    socket.disconnect();
  } catch (e) {}
}

const btnHubNav = document.querySelector('a.btn-nav-hub');
if (btnHubNav) {
  btnHubNav.addEventListener('click', () => {
    leavePong();
  });
}

window.addEventListener('pagehide', leavePong);
window.addEventListener('beforeunload', leavePong);

// Audio Web Audio API
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
}
window.addEventListener('click', initAudio, { once: true });
window.addEventListener('keydown', initAudio, { once: true });

function playPongSound(type) {
  if (!soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;

  if (type === 'hit') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } else if (type === 'wall') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } else if (type === 'score') {
    const notes = [440, 660, 880];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const st = now + idx * 0.09;
      osc.frequency.setValueAtTime(freq, st);
      gain.gain.setValueAtTime(0.25, st);
      gain.gain.exponentialRampToValueAtTime(0.01, st + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(st);
      osc.stop(st + 0.13);
    });
  }
}

// Entrées Clavier
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  let changed = false;
  if ((k === 'arrowup' || k === 'z' || k === 'w') && !inputState.up) {
    inputState.up = true;
    changed = true;
  }
  if ((k === 'arrowdown' || k === 's') && !inputState.down) {
    inputState.down = true;
    changed = true;
  }
  if (changed) sendInput();
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  let changed = false;
  if ((k === 'arrowup' || k === 'z' || k === 'w') && inputState.up) {
    inputState.up = false;
    changed = true;
  }
  if ((k === 'arrowdown' || k === 's') && inputState.down) {
    inputState.down = false;
    changed = true;
  }
  if (changed) sendInput();
});

// Suivi Souris sur le Canvas
canvas.addEventListener('mousemove', (e) => {
  if (myRole === 'spectator') return;
  const rect = canvas.getBoundingClientRect();
  const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
  socket.emit('pong_paddle_move', { y: mouseY - 50 });
});

// Contrôles tactiles
btnTouchUp.addEventListener('touchstart', (e) => {
  e.preventDefault();
  inputState.up = true;
  sendInput();
}, { passive: false });
btnTouchUp.addEventListener('touchend', (e) => {
  e.preventDefault();
  inputState.up = false;
  sendInput();
}, { passive: false });

btnTouchDown.addEventListener('touchstart', (e) => {
  e.preventDefault();
  inputState.down = true;
  sendInput();
}, { passive: false });
btnTouchDown.addEventListener('touchend', (e) => {
  e.preventDefault();
  inputState.down = false;
  sendInput();
}, { passive: false });

function sendInput() {
  if (myRole === 'spectator') return;
  socket.emit('pong_input', inputState);
}

// Rendu Graphique Pong (60 FPS)
function renderPong() {
  requestAnimationFrame(renderPong);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Fond du terrain & Ligne médiane en pointillés
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 12]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);

  // 2. Traînée de la balle
  for (let i = 0; i < ballTrail.length; i++) {
    const pt = ballTrail[i];
    const alpha = (i + 1) / ballTrail.length * 0.4;
    ctx.fillStyle = `rgba(0, 210, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pongState.ball.radius * (0.5 + alpha * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Dessiner la Balle
  const b = pongState.ball;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#00d2ff';
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4. Raquette Joueur 1 (Gauche, Cyan)
  const p1 = pongState.p1;
  ctx.save();
  ctx.fillStyle = '#00d2ff';
  ctx.shadowColor = '#00d2ff';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.roundRect(30, p1.y, p1.width, p1.height, 6);
  ctx.fill();
  ctx.restore();

  // 5. Raquette Joueur 2 / Bot (Droite, Rose néon)
  const p2 = pongState.p2;
  ctx.save();
  ctx.fillStyle = '#ff007f';
  ctx.shadowColor = '#ff007f';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.roundRect(canvas.width - 30 - p2.width, p2.y, p2.width, p2.height, 6);
  ctx.fill();
  ctx.restore();
}
requestAnimationFrame(renderPong);

