import { useEffect, useRef, useState, useCallback } from "react";

const WORDS_T1 = ["cat","dog","run","fly","map","key","sun","red","ice","jet","sky","arc","bot","gem","owl"];
const WORDS_T2 = ["space","laser","orbit","comet","blast","pilot","nebula","rocket","meteor","planet","cosmic","photon","quasar","plasma","vortex"];
const WORDS_T3 = ["asteroid","velocity","supernova","wormhole","galaxies","starlight","gravitas","interstellar","nebulous","celestial","cosmonaut","satellite","trajectory","aerospace","horizons"];

const COLORS = {
  bg: "#000000",
  cyan: "#00FFFF",
  asteroid: "#4a3728",
  asteroidEdge: "#ff6a1a",
  word: "#FFFFFF",
  laser: "#00FFFF",
  explosion: "#FF6600",
  bossFill: "#1a0033",
  bossEdge: "#FF00FF",
};

const STAR_COLORS = ["#ffffff", "#aad4ff", "#ffd6aa", "#ffaaaa"] as const;

type Asteroid = {
  id: number;
  x: number;
  y: number;
  word: string;
  remaining: string;
  speed: number;
  radius: number;
  shape: number[]; // radii multipliers
  rotation: number;
  rotSpeed: number;
  isBoss?: boolean;
  maxHp?: number;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string };
type Laser = { x1: number; y1: number; x2: number; y2: number; life: number };
type Star = { x: number; y: number; speed: number; size: number; twinkle: number; color: string };

type GameState = "start" | "playing" | "gameover";

function readStoredHighScore(): number {
  if (typeof window === "undefined") return 0;
  const v = parseInt(window.localStorage.getItem("astrotype_highscore") ?? "0", 10);
  return Number.isFinite(v) ? v : 0;
}

function letterCountNoHyphen(word: string): number {
  return [...word].filter((c) => c !== "-").length;
}

function stripLeadingHyphens(s: string): string {
  let out = s;
  while (out.startsWith("-")) out = out.slice(1);
  return out;
}

function firstTypingChar(remaining: string): string | null {
  for (const c of remaining) {
    if (c !== "-") return c.toLowerCase();
  }
  return null;
}

function comboToMultiplier(combo: number): number {
  if (combo < 10) return 1;
  if (combo < 20) return 2;
  if (combo < 30) return 3;
  return 4;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>("start");
  const [hud, setHud] = useState(() => ({
    score: 0,
    lives: 3,
    level: 1,
    best: readStoredHighScore(),
  }));
  const [wrongFlash, setWrongFlash] = useState(0);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);

  const stateRef = useRef<GameState>("start");
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const levelRef = useRef(1);
  const destroyedRef = useRef(0);
  const asteroidsRef = useRef<Asteroid[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lasersRef = useRef<Laser[]>([]);
  const starsRef = useRef<Star[]>([]);
  const activeIdRef = useRef<number | null>(null);
  const typedRef = useRef<string>("");
  const shipAngleRef = useRef(-Math.PI / 2);
  const shakeRef = useRef(0);
  const levelUpFlashRef = useRef(0);
  const bossDestroyedFlashRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const lastTimeRef = useRef(0);
  const idCounterRef = useRef(0);
  const sizeRef = useRef({ w: 800, h: 600 });
  const wrongFlashTimerRef = useRef(0);

  const highScoreRef = useRef(readStoredHighScore());
  const nebulaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const comboRef = useRef(0);
  const comboMultiplierRef = useRef(1);
  const comboResetFlashRef = useRef(0);
  const bossSpawnedForLevelRef = useRef(0);

  // Audio (Web Audio synthesized SFX)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const getCtx = () => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      audioCtxRef.current = new AC();
    }
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    return audioCtxRef.current;
  };
  const playLaserSfx = () => {
    if (mutedRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.12);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  };
  const playExplosionSfx = () => {
    if (mutedRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.45;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = 1 - i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
    noise.stop(t + dur);
  };

  const persistHighScoreIfNeeded = useCallback(() => {
    const s = scoreRef.current;
    if (s > highScoreRef.current) {
      highScoreRef.current = s;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("astrotype_highscore", String(s));
      }
    }
  }, []);

  const initStars = (w: number, h: number) => {
    const stars: Star[] = [];
    for (let layer = 0; layer < 3; layer++) {
      const count = layer === 0 ? 80 : layer === 1 ? 50 : 25;
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          speed: 10 + layer * 20,
          size: 0.5 + layer * 0.7,
          twinkle: Math.random(),
          color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)] ?? "#ffffff",
        });
      }
    }
    starsRef.current = stars;
  };

  const buildNebulaCanvas = (w: number, h: number) => {
    let nc = nebulaCanvasRef.current;
    if (!nc) {
      nc = document.createElement("canvas");
      nebulaCanvasRef.current = nc;
    }
    nc.width = w;
    nc.height = h;
    const nctx = nc.getContext("2d");
    if (!nctx) return;
    nctx.clearRect(0, 0, w, h);
    const blobs: Array<{ cx: number; cy: number; r: number; inner: string }> = [
      { cx: w * 0.2, cy: h * 0.3, r: w * 0.35, inner: "rgba(80, 0, 120, 0.18)" },
      { cx: w * 0.75, cy: h * 0.6, r: w * 0.3, inner: "rgba(0, 60, 120, 0.15)" },
      { cx: w * 0.5, cy: h * 0.8, r: w * 0.25, inner: "rgba(120, 0, 60, 0.12)" },
      { cx: w * 0.1, cy: h * 0.7, r: w * 0.2, inner: "rgba(0, 80, 80, 0.10)" },
    ];
    for (const b of blobs) {
      const g = nctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r);
      g.addColorStop(0, b.inner);
      g.addColorStop(1, "rgba(0,0,0,0)");
      nctx.fillStyle = g;
      nctx.fillRect(0, 0, w, h);
    }
  };

  const resetCombo = () => {
    comboRef.current = 0;
    comboMultiplierRef.current = 1;
    comboResetFlashRef.current = 0.3;
  };

  const resetGame = useCallback(() => {
    scoreRef.current = 0;
    livesRef.current = 3;
    levelRef.current = 1;
    destroyedRef.current = 0;
    asteroidsRef.current = [];
    particlesRef.current = [];
    lasersRef.current = [];
    activeIdRef.current = null;
    typedRef.current = "";
    spawnTimerRef.current = 0;
    levelUpFlashRef.current = 0;
    bossDestroyedFlashRef.current = 0;
    shakeRef.current = 0;
    bossSpawnedForLevelRef.current = 0;
    resetCombo();
    setHud({ score: 0, lives: 3, level: 1, best: highScoreRef.current });
  }, []);

  const wordsForLevel = (lvl: number) => {
    if (lvl <= 2) return WORDS_T1;
    if (lvl <= 4) return WORDS_T2;
    return WORDS_T3;
  };
  const maxAsteroids = (lvl: number) => Math.min(6, 2 + Math.floor((lvl - 1) / 2));
  const asteroidSpeed = (lvl: number) => 40 + (lvl - 1) * 8;

  const spawnBoss = () => {
    const { w } = sizeRef.current;
    const lvl = levelRef.current;
    const w1 = WORDS_T3[Math.floor(Math.random() * WORDS_T3.length)]!;
    const w2 = WORDS_T3[Math.floor(Math.random() * WORDS_T3.length)]!;
    const word = `${w1}-${w2}`;
    const maxHp = letterCountNoHyphen(word);
    const radius = 55;
    const verts = 9;
    const shape: number[] = [];
    for (let i = 0; i < verts; i++) shape.push(0.75 + Math.random() * 0.4);
    const x = radius + Math.random() * (w - radius * 2);
    asteroidsRef.current.push({
      id: idCounterRef.current++,
      x,
      y: -radius,
      word,
      remaining: word,
      speed: asteroidSpeed(lvl) * 0.6,
      radius,
      shape,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
      isBoss: true,
      maxHp,
    });
  };

  const spawnAsteroid = () => {
    if (asteroidsRef.current.some((a) => a.isBoss)) return;
    const { w } = sizeRef.current;
    const lvl = levelRef.current;
    const pool = wordsForLevel(lvl);
    const usedFirst = new Set(asteroidsRef.current.map((a) => firstTypingChar(a.remaining)).filter(Boolean));
    const candidates = pool.filter((wrd) => {
      const fc = wrd[0]?.toLowerCase();
      return fc && !usedFirst.has(fc);
    });
    const word = (candidates.length ? candidates : pool)[Math.floor(Math.random() * (candidates.length ? candidates.length : pool.length))]!;
    const radius = 30 + word.length * 3;
    const verts = 9;
    const shape: number[] = [];
    for (let i = 0; i < verts; i++) shape.push(0.75 + Math.random() * 0.4);
    const x = radius + Math.random() * (w - radius * 2);
    asteroidsRef.current.push({
      id: idCounterRef.current++,
      x,
      y: -radius,
      word,
      remaining: word,
      speed: asteroidSpeed(lvl),
      radius,
      shape,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
    });
  };

  const explode = (x: number, y: number, particleCount?: number) => {
    const n = particleCount ?? 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 120;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 0.5,
        maxLife: 0.5,
        color: Math.random() < 0.5 ? "#FF6600" : "#FFCC33",
      });
    }
  };

  useEffect(() => {
    const v = readStoredHighScore();
    highScoreRef.current = v;
    setHud((prev) => ({ ...prev, best: v }));
  }, []);

  // Resize
  useEffect(() => {
    const handleResize = () => {
      const c = canvasRef.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      c.width = w * dpr;
      c.height = h * dpr;
      const ctx = c.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
      initStars(w, h);
      buildNebulaCanvas(w, h);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keyboard
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (stateRef.current === "start") {
        resetGame();
        stateRef.current = "playing";
        setGameState("playing");
        return;
      }
      if (stateRef.current === "gameover") {
        if (e.key.toLowerCase() === "r") {
          resetGame();
          stateRef.current = "playing";
          setGameState("playing");
        }
        return;
      }
      if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return;
      const ch = e.key.toLowerCase();

      const matchesFirst = (a: Asteroid) => firstTypingChar(a.remaining) === ch;

      let target: Asteroid | null = null;
      if (activeIdRef.current !== null) {
        const cur = asteroidsRef.current.find((a) => a.id === activeIdRef.current) ?? null;
        if (cur && matchesFirst(cur)) target = cur;
      }
      if (!target) {
        const candidates = asteroidsRef.current.filter((a) => matchesFirst(a));
        if (candidates.length) {
          candidates.sort((a, b) => b.y - a.y);
          target = candidates[0]!;
          activeIdRef.current = target.id;
          typedRef.current = "";
        }
      }
      if (!target) {
        wrongFlashTimerRef.current = 0.25;
        resetCombo();
        setWrongFlash(Date.now());
        return;
      }

      let rem = stripLeadingHyphens(target.remaining);
      if (firstTypingChar(rem) !== ch) {
        wrongFlashTimerRef.current = 0.25;
        resetCombo();
        setWrongFlash(Date.now());
        return;
      }

      typedRef.current += ch;
      rem = rem.slice(1);
      rem = stripLeadingHyphens(rem);
      target.remaining = rem;

      const { w, h } = sizeRef.current;
      const shipX = w / 2;
      const shipY = h - 60;
      lasersRef.current.push({ x1: shipX, y1: shipY - 20, x2: target.x, y2: target.y, life: 0.15 });
      playLaserSfx();

      comboRef.current += 1;
      comboMultiplierRef.current = comboToMultiplier(comboRef.current);

      if (target.remaining.length === 0) {
        const isBoss = !!target.isBoss;
        explode(target.x, target.y, isBoss ? 20 : undefined);
        playExplosionSfx();
        const mult = comboMultiplierRef.current;
        if (isBoss) {
          scoreRef.current += target.word.length * levelRef.current * 50 * mult;
          shakeRef.current = 0.6;
          bossDestroyedFlashRef.current = 2;
        } else {
          scoreRef.current += target.word.length * levelRef.current * 10 * mult;
        }
        persistHighScoreIfNeeded();
        asteroidsRef.current = asteroidsRef.current.filter((a) => a.id !== target!.id);
        activeIdRef.current = null;
        typedRef.current = "";
        destroyedRef.current++;
        if (destroyedRef.current % 5 === 0) {
          levelRef.current++;
          levelUpFlashRef.current = 1.5;
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [resetGame, persistHighScoreIfNeeded]);

  // HUD sync interval
  useEffect(() => {
    const id = setInterval(() => {
      setHud({
        score: scoreRef.current,
        lives: livesRef.current,
        level: levelRef.current,
        best: highScoreRef.current,
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Game loop
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const loop = (t: number) => {
      const dt = lastTimeRef.current ? Math.min(0.05, (t - lastTimeRef.current) / 1000) : 0;
      lastTimeRef.current = t;
      const { w, h } = sizeRef.current;

      let sx = 0,
        sy = 0;
      if (shakeRef.current > 0) {
        shakeRef.current -= dt;
        sx = (Math.random() - 0.5) * 6;
        sy = (Math.random() - 0.5) * 6;
      }
      if (wrongFlashTimerRef.current > 0) wrongFlashTimerRef.current -= dt;
      if (comboResetFlashRef.current > 0) comboResetFlashRef.current -= dt;
      if (bossDestroyedFlashRef.current > 0) bossDestroyedFlashRef.current -= dt;

      ctx.save();
      ctx.translate(sx, sy);

      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(-10, -10, w + 20, h + 20);

      const nebula = nebulaCanvasRef.current;
      if (nebula) {
        ctx.drawImage(nebula, 0, 0);
      }

      for (const s of starsRef.current) {
        if (stateRef.current === "playing") {
          s.y += s.speed * dt;
          if (s.y > h) {
            s.y = 0;
            s.x = Math.random() * w;
          }
        }
        s.twinkle += dt * (1 + Math.random());
        const alpha = 0.4 + 0.6 * Math.abs(Math.sin(s.twinkle));
        const hex = s.color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const gch = parseInt(hex.slice(2, 4), 16);
        const bch = parseInt(hex.slice(4, 6), 16);
        ctx.fillStyle = `rgba(${r},${gch},${bch},${alpha})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }

      if (stateRef.current === "playing") {
        const lvl = levelRef.current;
        const hasBoss = asteroidsRef.current.some((a) => a.isBoss);
        if (lvl > 0 && lvl % 3 === 0 && !hasBoss && bossSpawnedForLevelRef.current !== lvl) {
          const cap = maxAsteroids(lvl);
          while (asteroidsRef.current.length >= cap) {
            const idx = asteroidsRef.current.findIndex((a) => !a.isBoss);
            if (idx === -1) break;
            asteroidsRef.current.splice(idx, 1);
          }
          if (asteroidsRef.current.length < cap) {
            spawnBoss();
            bossSpawnedForLevelRef.current = lvl;
          }
        }

        spawnTimerRef.current -= dt;
        const bossBlocksSpawn = asteroidsRef.current.some((a) => a.isBoss);
        if (
          !bossBlocksSpawn &&
          asteroidsRef.current.length < maxAsteroids(levelRef.current) &&
          spawnTimerRef.current <= 0
        ) {
          spawnAsteroid();
          spawnTimerRef.current = 1.2 + Math.random() * 1.5;
        }

        for (const a of asteroidsRef.current) {
          a.y += a.speed * dt;
          a.rotation += a.rotSpeed * dt;
        }
        const survived: Asteroid[] = [];
        for (const a of asteroidsRef.current) {
          if (a.y - a.radius > h) {
            livesRef.current--;
            shakeRef.current = 0.3;
            resetCombo();
            if (activeIdRef.current === a.id) {
              activeIdRef.current = null;
              typedRef.current = "";
            }
            if (livesRef.current <= 0) {
              stateRef.current = "gameover";
              setGameState("gameover");
            }
          } else survived.push(a);
        }
        asteroidsRef.current = survived;

        const shipX = w / 2,
          shipY = h - 60;
        let targetAngle = -Math.PI / 2;
        const active = asteroidsRef.current.find((a) => a.id === activeIdRef.current);
        if (active) targetAngle = Math.atan2(active.y - shipY, active.x - shipX);
        let diff = targetAngle - shipAngleRef.current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        shipAngleRef.current += diff * Math.min(1, dt * 8);

        for (const a of asteroidsRef.current) {
          ctx.save();
          ctx.translate(a.x, a.y);
          ctx.rotate(a.rotation);
          ctx.beginPath();
          for (let i = 0; i < a.shape.length; i++) {
            const ang = (i / a.shape.length) * Math.PI * 2;
            const r = a.radius * a.shape[i]!;
            const px = Math.cos(ang) * r;
            const py = Math.sin(ang) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          if (a.isBoss) {
            ctx.fillStyle = COLORS.bossFill;
            ctx.fill();
            ctx.lineWidth = a.id === activeIdRef.current ? 4 : 2.5;
            ctx.strokeStyle = COLORS.bossEdge;
            ctx.shadowColor = COLORS.bossEdge;
            ctx.shadowBlur = 25;
            ctx.stroke();
          } else {
            ctx.fillStyle = COLORS.asteroid;
            ctx.fill();
            ctx.lineWidth = a.id === activeIdRef.current ? 3 : 1.5;
            ctx.strokeStyle = COLORS.asteroidEdge;
            ctx.shadowColor = COLORS.asteroidEdge;
            ctx.shadowBlur = a.id === activeIdRef.current ? 18 : 8;
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          ctx.restore();

          ctx.font = "bold 16px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (a.isBoss) {
            ctx.font = "bold 11px Orbitron, sans-serif";
            ctx.fillStyle = COLORS.bossEdge;
            ctx.fillText("BOSS", a.x, a.y - a.radius - 14);
            ctx.font = "bold 16px 'JetBrains Mono', monospace";
          }
          ctx.fillStyle = COLORS.word;
          ctx.fillText(a.remaining, a.x, a.y);

          if (a.isBoss && a.maxHp) {
            const lettersLeft = letterCountNoHyphen(a.remaining);
            const ratio = a.maxHp > 0 ? lettersLeft / a.maxHp : 0;
            const barW = a.radius * 2;
            const barH = 5;
            const bx = a.x - barW / 2;
            const by = a.y + a.radius + 10;
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle = COLORS.bossEdge;
            ctx.fillRect(bx, by, barW * ratio, barH);
          }

          if (a.id === activeIdRef.current) {
            ctx.save();
            ctx.translate(a.x, a.y);
            ctx.rotate(t / 600);
            ctx.strokeStyle = COLORS.cyan;
            ctx.lineWidth = 2;
            ctx.shadowColor = COLORS.cyan;
            ctx.shadowBlur = 10;
            const r = a.radius + 10;
            const arm = 10;
            for (let i = 0; i < 4; i++) {
              ctx.save();
              ctx.rotate((i * Math.PI) / 2);
              ctx.beginPath();
              ctx.moveTo(r - arm, r);
              ctx.lineTo(r, r);
              ctx.lineTo(r, r - arm);
              ctx.stroke();
              ctx.restore();
            }
            ctx.restore();
          }
        }

        const aliveLasers: Laser[] = [];
        for (const l of lasersRef.current) {
          l.life -= dt;
          if (l.life > 0) {
            const alpha = l.life / 0.15;
            ctx.strokeStyle = `rgba(0,255,255,${alpha})`;
            ctx.lineWidth = 2;
            ctx.shadowColor = COLORS.cyan;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(l.x1, l.y1);
            ctx.lineTo(l.x2, l.y2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            aliveLasers.push(l);
          }
        }
        lasersRef.current = aliveLasers;

        const aliveP: Particle[] = [];
        for (const p of particlesRef.current) {
          p.life -= dt;
          if (p.life > 0) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= 0.96;
            p.vy *= 0.96;
            const alpha = p.life / p.maxLife;
            ctx.fillStyle = p.color.replace(")", `,${alpha})`).replace("#", "rgba(").length > 0
              ? `rgba(255,${p.color === "#FF6600" ? 102 : 204},${p.color === "#FF6600" ? 0 : 51},${alpha})`
              : p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
            aliveP.push(p);
          }
        }
        particlesRef.current = aliveP;

        ctx.save();
        ctx.translate(shipX, shipY);
        ctx.rotate(shipAngleRef.current + Math.PI / 2);
        const flameLen = 14 + Math.random() * 8;
        const grad = ctx.createLinearGradient(0, 12, 0, 12 + flameLen);
        grad.addColorStop(0, "#00FFFF");
        grad.addColorStop(1, "rgba(0,255,255,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-6, 12);
        ctx.lineTo(6, 12);
        ctx.lineTo(0, 12 + flameLen);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(14, 14);
        ctx.lineTo(0, 8);
        ctx.lineTo(-14, 14);
        ctx.closePath();
        ctx.fillStyle = "#0a1a22";
        ctx.fill();
        ctx.strokeStyle = COLORS.cyan;
        ctx.lineWidth = 2;
        ctx.shadowColor = COLORS.cyan;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        const typed = typedRef.current;
        const showWord = active ? `${typed}${active.remaining}` : typed;
        const indY = h - 18;
        ctx.font = "bold 18px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const wrong = wrongFlashTimerRef.current > 0;
        const indColor = wrong ? "#ff3b3b" : COLORS.cyan;
        ctx.fillStyle = `rgba(0,0,0,0.5)`;
        const text = showWord || "_ _ _";
        const tw = ctx.measureText(text).width + 28;
        ctx.fillRect(w / 2 - tw / 2, indY - 16, tw, 30);
        ctx.strokeStyle = indColor;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = indColor;
        ctx.shadowBlur = wrong ? 16 : 8;
        ctx.strokeRect(w / 2 - tw / 2, indY - 16, tw, 30);
        ctx.shadowBlur = 0;
        if (active) {
          const fullW = ctx.measureText(showWord).width;
          let cursor = w / 2 - fullW / 2;
          ctx.textAlign = "left";
          ctx.fillStyle = COLORS.cyan;
          ctx.fillText(typed, cursor, indY);
          cursor += ctx.measureText(typed).width;
          ctx.fillStyle = "#888";
          ctx.fillText(active.remaining, cursor, indY);
          if (Math.floor(t / 400) % 2 === 0) {
            ctx.fillStyle = COLORS.cyan;
            ctx.fillRect(cursor, indY - 10, 2, 20);
          }
        } else {
          ctx.fillStyle = "#555";
          ctx.textAlign = "center";
          ctx.fillText("type to target", w / 2, indY);
        }

        if (levelUpFlashRef.current > 0) {
          levelUpFlashRef.current -= dt;
          const a = Math.min(1, levelUpFlashRef.current / 1.5);
          ctx.font = "900 56px Orbitron, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = `rgba(0,255,255,${a})`;
          ctx.shadowColor = COLORS.cyan;
          ctx.shadowBlur = 30;
          ctx.fillText("LEVEL UP!", w / 2, h / 2);
          ctx.shadowBlur = 0;
        }

        if (bossDestroyedFlashRef.current > 0) {
          const a = Math.min(1, bossDestroyedFlashRef.current / 2);
          ctx.font = "900 52px Orbitron, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = `rgba(255,0,255,${a})`;
          ctx.shadowColor = COLORS.bossEdge;
          ctx.shadowBlur = 35;
          ctx.fillText("BOSS DESTROYED!", w / 2, h / 2 - 70);
          ctx.shadowBlur = 0;
        }

        const mult = comboMultiplierRef.current;
        const combo = comboRef.current;
        const pulseBlur = 10 + ((Math.sin(t / 200) + 1) / 2) * 15;
        const comboFlash = comboResetFlashRef.current > 0;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        let stackY = h - 24;
        if (mult > 1) {
          ctx.font = "900 28px Orbitron, sans-serif";
          ctx.fillStyle = comboFlash ? "#ff3b3b" : "#FFD700";
          ctx.shadowColor = comboFlash ? "#ff3b3b" : "#FFD700";
          ctx.shadowBlur = pulseBlur;
          ctx.fillText(`${mult}x COMBO`, w - 20, stackY);
          ctx.shadowBlur = 0;
          stackY -= 34;
        }
        if (combo > 0) {
          ctx.font = "12px 'JetBrains Mono', monospace";
          ctx.fillStyle = "#888888";
          ctx.fillText(`combo: ${combo}`, w - 20, stackY);
        }
      }

      ctx.restore();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hearts = "♥".repeat(Math.max(0, hud.lives));

  const showNewHighOnGameOver =
    gameState === "gameover" && scoreRef.current === highScoreRef.current && scoreRef.current > 0;

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {gameState === "playing" && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4 pointer-events-none"
          style={{ fontFamily: "'Orbitron', sans-serif" }}
        >
          <div className="flex items-center gap-6">
            <div className="text-cyan-400 text-xl font-bold tracking-widest" style={{ textShadow: "0 0 10px #00FFFF" }}>
              SCORE {hud.score.toLocaleString()}
            </div>
            <div className="text-cyan-400 text-lg font-bold tracking-widest" style={{ textShadow: "0 0 10px #00FFFF" }}>
              BEST: {hud.best.toLocaleString()}
            </div>
          </div>
          <div className="text-white text-lg font-bold tracking-widest" style={{ textShadow: "0 0 10px #00FFFF" }}>
            LEVEL {hud.level}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-2xl tracking-wider" style={{ color: "#ff3b6b", textShadow: "0 0 10px #ff3b6b" }}>
              {hearts}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => {
          const next = !mutedRef.current;
          mutedRef.current = next;
          setMuted(next);
        }}
        aria-label={muted ? "Unmute sound" : "Mute sound"}
        className="absolute top-4 right-4 z-10 h-10 w-10 flex items-center justify-center rounded-md border border-cyan-400/40 bg-black/50 text-cyan-300 hover:bg-cyan-400/10 transition"
        style={{ textShadow: "0 0 8px #00FFFF", boxShadow: "0 0 12px rgba(0,255,255,0.25)" }}
      >
        {muted ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        )}
      </button>

      {gameState === "start" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4" style={{ fontFamily: "'Orbitron', sans-serif" }}>
          <h1
            className="text-6xl md:text-8xl font-black tracking-[0.2em] text-cyan-300"
            style={{ textShadow: "0 0 20px #00FFFF, 0 0 40px #00FFFF, 0 0 80px #00aacc" }}
          >
            ASTROTYPE
          </h1>
          <p className="mt-6 text-white/70 text-lg tracking-wider">Destroy asteroids by typing their words</p>
          <p className="mt-16 text-cyan-400 text-xl tracking-[0.3em] animate-pulse" style={{ textShadow: "0 0 12px #00FFFF" }}>
            PRESS ANY KEY TO START
          </p>
        </div>
      )}

      {gameState === "gameover" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 bg-black/60" style={{ fontFamily: "'Orbitron', sans-serif" }}>
          <h2
            className="text-5xl md:text-7xl font-black tracking-[0.2em]"
            style={{ color: "#ff3b6b", textShadow: "0 0 20px #ff3b6b, 0 0 40px #ff3b6b" }}
          >
            GAME OVER
          </h2>
          {showNewHighOnGameOver && (
            <p
              className="mt-6 text-2xl md:text-3xl font-black tracking-[0.25em] text-yellow-400"
              style={{ textShadow: "0 0 14px #ffd700, 0 0 28px #ffaa00, 0 0 42px #ff8800" }}
            >
              NEW HIGH SCORE!
            </p>
          )}
          <p className="mt-8 text-white text-2xl tracking-widest">
            FINAL SCORE: <span className="text-cyan-300" style={{ textShadow: "0 0 10px #00FFFF" }}>{scoreRef.current.toLocaleString()}</span>
          </p>
          <p className="mt-12 text-cyan-400 text-lg tracking-[0.3em] animate-pulse" style={{ textShadow: "0 0 12px #00FFFF" }}>
            PRESS R TO RESTART
          </p>
        </div>
      )}

      <span className="hidden">{wrongFlash}</span>
    </div>
  );
}
