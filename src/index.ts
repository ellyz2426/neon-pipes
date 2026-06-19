import {
  World, createSystem, PanelUI, PanelDocument, UIKitDocument, UIKit, eq,
  Follower, FollowBehavior,
  Mesh, Group, BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry,
  PlaneGeometry, EdgesGeometry, LineSegments, BufferGeometry, Float32BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial,
  Color, Vector3, Fog,
  AmbientLight, PointLight, DirectionalLight,
  AdditiveBlending, DoubleSide, InputComponent,
} from '@iwsdk/core';

// ============================================================
// TYPES & CONSTANTS
// ============================================================

type GameState = 'title' | 'modeselect' | 'difficulty' | 'countdown' | 'playing' | 'paused' | 'gameover' | 'leaderboard' | 'achievements' | 'stats' | 'settings' | 'help' | 'skins' | 'campaign';
type GameMode = 'campaign' | 'timed' | 'endless' | 'zen' | 'daily' | 'speed' | 'puzzle' | 'practice';
type Difficulty = 'easy' | 'medium' | 'hard';
type Direction = 'up' | 'right' | 'down' | 'left';

// Pipe types: connections expressed as set of directions
enum PipeType {
  STRAIGHT_H = 0,  // left-right
  STRAIGHT_V = 1,  // up-down
  ELBOW_UR = 2,    // up-right
  ELBOW_RD = 3,    // right-down
  ELBOW_DL = 4,    // down-left
  ELBOW_LU = 5,    // left-up
  T_URD = 6,       // up-right-down
  T_RDL = 7,       // right-down-left
  T_DLU = 8,       // down-left-up
  T_LUR = 9,       // left-up-right
  CROSS = 10,      // all four
}

const PIPE_CONNECTIONS: Record<PipeType, Direction[]> = {
  [PipeType.STRAIGHT_H]: ['left', 'right'],
  [PipeType.STRAIGHT_V]: ['up', 'down'],
  [PipeType.ELBOW_UR]: ['up', 'right'],
  [PipeType.ELBOW_RD]: ['right', 'down'],
  [PipeType.ELBOW_DL]: ['down', 'left'],
  [PipeType.ELBOW_LU]: ['left', 'up'],
  [PipeType.T_URD]: ['up', 'right', 'down'],
  [PipeType.T_RDL]: ['right', 'down', 'left'],
  [PipeType.T_DLU]: ['down', 'left', 'up'],
  [PipeType.T_LUR]: ['left', 'up', 'right'],
  [PipeType.CROSS]: ['up', 'right', 'down', 'left'],
};

// Rotation map: which pipe type results from rotating CW
const ROTATE_CW: Record<PipeType, PipeType> = {
  [PipeType.STRAIGHT_H]: PipeType.STRAIGHT_V,
  [PipeType.STRAIGHT_V]: PipeType.STRAIGHT_H,
  [PipeType.ELBOW_UR]: PipeType.ELBOW_RD,
  [PipeType.ELBOW_RD]: PipeType.ELBOW_DL,
  [PipeType.ELBOW_DL]: PipeType.ELBOW_LU,
  [PipeType.ELBOW_LU]: PipeType.ELBOW_UR,
  [PipeType.T_URD]: PipeType.T_RDL,
  [PipeType.T_RDL]: PipeType.T_DLU,
  [PipeType.T_DLU]: PipeType.T_LUR,
  [PipeType.T_LUR]: PipeType.T_URD,
  [PipeType.CROSS]: PipeType.CROSS,
};

const ROTATE_CCW: Record<PipeType, PipeType> = {
  [PipeType.STRAIGHT_H]: PipeType.STRAIGHT_V,
  [PipeType.STRAIGHT_V]: PipeType.STRAIGHT_H,
  [PipeType.ELBOW_UR]: PipeType.ELBOW_LU,
  [PipeType.ELBOW_RD]: PipeType.ELBOW_UR,
  [PipeType.ELBOW_DL]: PipeType.ELBOW_RD,
  [PipeType.ELBOW_LU]: PipeType.ELBOW_DL,
  [PipeType.T_URD]: PipeType.T_LUR,
  [PipeType.T_RDL]: PipeType.T_URD,
  [PipeType.T_DLU]: PipeType.T_RDL,
  [PipeType.T_LUR]: PipeType.T_DLU,
  [PipeType.CROSS]: PipeType.CROSS,
};

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const DIR_OFFSET: Record<Direction, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

interface CellData {
  pipeType: PipeType;
  isSource: boolean;
  isDrain: boolean;
  isLocked: boolean;
  isConnected: boolean;
  isBlocked: boolean; // Obstacle cell
  flowProgress: number;
  mesh: Group | null;
  highlightMesh: Mesh | null;
  rotAnim: number; // Rotation animation progress (0 = idle, >0 = animating)
  rotDir: number;  // 1 = CW, -1 = CCW
  entranceDelay: number; // Staggered entrance animation
  entranceProgress: number;
}

// Undo history entry
interface MoveEntry {
  x: number;
  y: number;
  prevType: PipeType;
  newType: PipeType;
}

// Power-up types
type PowerUpType = 'hint' | 'undo' | 'freeze' | 'reveal' | 'lock';

// Star rating from moves
type StarRating = 0 | 1 | 2 | 3;

function getStarRating(moves: number, minMoves: number): StarRating {
  if (moves <= minMoves) return 3;
  if (moves <= minMoves * 1.5) return 2;
  if (moves <= minMoves * 2.5) return 1;
  return 0;
}

interface PowerUp {
  type: PowerUpType;
  name: string;
  desc: string;
  icon: string;
  cost: number;
}

const POWER_UPS: PowerUp[] = [
  { type: 'hint', name: 'Hint', desc: 'Highlight a pipe that needs rotating', icon: '?', cost: 25 },
  { type: 'undo', name: 'Undo', desc: 'Undo last move', icon: '<', cost: 0 },
  { type: 'freeze', name: 'Freeze', desc: 'Pause the timer for 10s', icon: '*', cost: 50 },
  { type: 'reveal', name: 'Reveal', desc: 'Show the solution for 2s', icon: '!', cost: 100 },
  { type: 'lock', name: 'Lock', desc: 'Lock a correctly placed pipe', icon: '#', cost: 30 },
];

// Campaign zone definitions
interface CampaignZone {
  name: string;
  levels: number;
  gridMin: number;
  gridMax: number;
  timeMod: number;
  desc: string;
  color: number;
}

const CAMPAIGN_ZONES: CampaignZone[] = [
  { name: 'Tutorial Basin', levels: 6, gridMin: 3, gridMax: 5, timeMod: 1.5, desc: 'Learn the basics of pipe flow', color: 0x00ffcc },
  { name: 'Flow Junction', levels: 6, gridMin: 5, gridMax: 6, timeMod: 1.3, desc: 'The paths grow complex', color: 0x44ff44 },
  { name: 'Pressure Works', levels: 6, gridMin: 6, gridMax: 7, timeMod: 1.1, desc: 'Speed and precision required', color: 0xffcc00 },
  { name: 'Neon Labyrinth', levels: 6, gridMin: 7, gridMax: 8, timeMod: 1.0, desc: 'Navigate the maze of pipes', color: 0xff8844 },
  { name: 'Flux Core', levels: 6, gridMin: 8, gridMax: 9, timeMod: 0.9, desc: 'Only the skilled survive', color: 0xff44ff },
  { name: 'Quantum Grid', levels: 6, gridMin: 9, gridMax: 10, timeMod: 0.8, desc: 'Master the quantum flow', color: 0xff4444 },
];

interface Theme {
  name: string;
  grid: number; accent: number; bg: number; fog: number; wall: number;
  pipe: number; pipeGlow: number; flow: number; source: number; drain: number;
}

const THEMES: Theme[] = [
  { name: 'Neon Holodeck', grid: 0x00ffff, accent: 0x00ffcc, bg: 0x000811, fog: 0x000811, wall: 0x001a2a, pipe: 0x00aacc, pipeGlow: 0x00ffff, flow: 0x00ff88, source: 0x00ff44, drain: 0xff4444 },
  { name: 'Crimson Grid', grid: 0xff4444, accent: 0xff6644, bg: 0x0a0000, fog: 0x0a0000, wall: 0x2a0000, pipe: 0xcc4444, pipeGlow: 0xff6666, flow: 0xff8844, source: 0x44ff44, drain: 0xff2222 },
  { name: 'Toxic Neon', grid: 0x44ff44, accent: 0x66ff44, bg: 0x000a00, fog: 0x000a00, wall: 0x002a00, pipe: 0x44cc44, pipeGlow: 0x66ff66, flow: 0x88ff44, source: 0x00ff88, drain: 0xff4444 },
  { name: 'Ultra Violet', grid: 0x8844ff, accent: 0xaa66ff, bg: 0x06000a, fog: 0x06000a, wall: 0x1a002a, pipe: 0x8844cc, pipeGlow: 0xaa66ff, flow: 0xcc88ff, source: 0x44ff88, drain: 0xff4488 },
  { name: 'Solar Blaze', grid: 0xff8800, accent: 0xffaa44, bg: 0x0a0400, fog: 0x0a0400, wall: 0x2a1400, pipe: 0xcc8844, pipeGlow: 0xffaa44, flow: 0xffcc44, source: 0x44ff44, drain: 0xff4444 },
];

interface PipeSkin {
  name: string; color: number; emissive: number; glowColor: number;
  unlockCondition: string; unlockCheck: (s: CareerStats) => boolean;
}

const PIPE_SKINS: PipeSkin[] = [
  { name: 'Neon Cyan', color: 0x00aacc, emissive: 0x004455, glowColor: 0x00ffff, unlockCondition: 'Default', unlockCheck: () => true },
  { name: 'Solar Flare', color: 0xff6622, emissive: 0x552200, glowColor: 0xff8844, unlockCondition: '50 pipes connected', unlockCheck: (s) => s.totalPipes >= 50 },
  { name: 'Plasma Pink', color: 0xff44ff, emissive: 0x550055, glowColor: 0xff66ff, unlockCondition: '5K total score', unlockCheck: (s) => s.totalScore >= 5000 },
  { name: 'Frost Blue', color: 0x4488ff, emissive: 0x002255, glowColor: 0x66aaff, unlockCondition: '10 games played', unlockCheck: (s) => s.gamesPlayed >= 10 },
  { name: 'Toxic Green', color: 0x44ff44, emissive: 0x005500, glowColor: 0x66ff66, unlockCondition: 'x5 combo', unlockCheck: (s) => s.bestCombo >= 5 },
  { name: 'Royal Gold', color: 0xffcc00, emissive: 0x554400, glowColor: 0xffdd44, unlockCondition: 'Perfect level', unlockCheck: (s) => s.perfectLevels >= 1 },
  { name: 'Void Purple', color: 0x8844ff, emissive: 0x220055, glowColor: 0xaa66ff, unlockCondition: 'All modes played', unlockCheck: (s) => s.modesPlayed.size >= 8 },
  { name: 'Inferno', color: 0xff4444, emissive: 0x550000, glowColor: 0xff6666, unlockCondition: '80% accuracy', unlockCheck: (s) => s.gamesPlayed > 0 && (s.levelClears / Math.max(1, s.gamesPlayed)) >= 0.8 },
];

interface Achievement {
  id: string; name: string; desc: string;
  check: (s: CareerStats) => boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_flow', name: 'First Flow', desc: 'Complete your first level', check: s => s.levelClears >= 1 },
  { id: 'ten_flows', name: 'Flow Master', desc: 'Complete 10 levels', check: s => s.levelClears >= 10 },
  { id: 'fifty_flows', name: 'Pipeline Pro', desc: 'Complete 50 levels', check: s => s.levelClears >= 50 },
  { id: 'hundred_flows', name: 'Flow Legend', desc: 'Complete 100 levels', check: s => s.levelClears >= 100 },
  { id: 'score_1k', name: 'Getting Started', desc: 'Score 1,000 points', check: s => s.totalScore >= 1000 },
  { id: 'score_5k', name: 'Score Climber', desc: 'Score 5,000 points', check: s => s.totalScore >= 5000 },
  { id: 'score_10k', name: 'High Scorer', desc: 'Score 10,000 points', check: s => s.totalScore >= 10000 },
  { id: 'score_25k', name: 'Score Legend', desc: 'Score 25,000 points', check: s => s.totalScore >= 25000 },
  { id: 'combo_3', name: 'Combo Starter', desc: 'Reach x3 combo', check: s => s.bestCombo >= 3 },
  { id: 'combo_5', name: 'Combo Builder', desc: 'Reach x5 combo', check: s => s.bestCombo >= 5 },
  { id: 'combo_8', name: 'Combo Master', desc: 'Reach x8 combo', check: s => s.bestCombo >= 8 },
  { id: 'combo_10', name: 'Combo King', desc: 'Reach x10 combo', check: s => s.bestCombo >= 10 },
  { id: 'pipes_50', name: 'Plumber', desc: 'Connect 50 pipes total', check: s => s.totalPipes >= 50 },
  { id: 'pipes_100', name: 'Pipe Fitter', desc: 'Connect 100 pipes', check: s => s.totalPipes >= 100 },
  { id: 'pipes_500', name: 'Master Plumber', desc: 'Connect 500 pipes', check: s => s.totalPipes >= 500 },
  { id: 'perfect', name: 'Perfect Flow', desc: 'Complete with minimum moves', check: s => s.perfectLevels >= 1 },
  { id: 'speed_30', name: 'Speed Demon', desc: 'Complete level in under 30s', check: s => s.fastestClear < 30 && s.fastestClear > 0 },
  { id: 'speed_15', name: 'Lightning Fast', desc: 'Complete level in under 15s', check: s => s.fastestClear < 15 && s.fastestClear > 0 },
  { id: 'games_10', name: 'Regular Player', desc: 'Play 10 games', check: s => s.gamesPlayed >= 10 },
  { id: 'games_50', name: 'Dedicated', desc: 'Play 50 games', check: s => s.gamesPlayed >= 50 },
  { id: 'daily_done', name: 'Daily Solver', desc: 'Complete a daily challenge', check: s => s.dailyDone >= 1 },
  { id: 'daily_3', name: 'Daily Streak', desc: 'Complete 3 daily challenges', check: s => s.dailyDone >= 3 },
  { id: 'daily_7', name: 'Weekly Warrior', desc: 'Complete 7 daily challenges', check: s => s.dailyDone >= 7 },
  { id: 'zen_master', name: 'Zen Master', desc: 'Complete 10 zen levels', check: s => s.zenClears >= 10 },
  { id: 'timed_win', name: 'Beat the Clock', desc: 'Win a time attack', check: s => s.timedWins >= 1 },
  { id: 'endless_10', name: 'Endless Flow', desc: 'Clear 10 endless levels', check: s => s.endlessClears >= 10 },
  { id: 'campaign_z1', name: 'Zone 1 Clear', desc: 'Complete zone 1', check: s => s.campaignLevel >= 6 },
  { id: 'campaign_z3', name: 'Zone 3 Clear', desc: 'Complete zone 3', check: s => s.campaignLevel >= 18 },
  { id: 'campaign_z6', name: 'Campaign Master', desc: 'Complete all 6 zones', check: s => s.campaignLevel >= 36 },
  { id: 'skin_unlock', name: 'Fashionista', desc: 'Unlock a pipe skin', check: s => s.skinsUnlocked > 1 },
  { id: 'theme_all', name: 'Theme Explorer', desc: 'Use all 5 themes', check: s => s.themesUsed.size >= 5 },
  { id: 'all_modes', name: 'Mode Explorer', desc: 'Play all 8 modes', check: s => s.modesPlayed.size >= 8 },
  { id: 'level_10', name: 'Level 10', desc: 'Reach player level 10', check: s => s.level >= 10 },
  { id: 'level_25', name: 'Level 25', desc: 'Reach player level 25', check: s => s.level >= 25 },
  { id: 'level_50', name: 'Level 50', desc: 'Reach player level 50', check: s => s.level >= 50 },
  { id: 'no_mistakes', name: 'No Wasted Moves', desc: '3 levels with 0 wasted moves', check: s => s.noMistakeLevels >= 3 },
  { id: 'speed_chain', name: 'Speed Chain', desc: '5 levels under 60s each', check: s => s.speedChain >= 5 },
  { id: 'welcome', name: 'Welcome', desc: 'Play your first game', check: s => s.gamesPlayed >= 1 },
  { id: 'moves_100', name: 'Busy Plumber', desc: 'Make 100 total moves', check: s => s.totalMoves >= 100 },
  { id: 'moves_1000', name: 'Pipe Twister', desc: 'Make 1000 total moves', check: s => s.totalMoves >= 1000 },
  // Round 3 achievements
  { id: 'score_50k', name: 'Score Titan', desc: 'Score 50,000 points', check: s => s.totalScore >= 50000 },
  { id: 'score_100k', name: 'Score God', desc: 'Score 100,000 points', check: s => s.totalScore >= 100000 },
  { id: 'combo_15', name: 'Combo Legend', desc: 'Reach x15 combo', check: s => s.bestCombo >= 15 },
  { id: 'combo_20', name: 'Combo God', desc: 'Reach x20 combo', check: s => s.bestCombo >= 20 },
  { id: 'pipes_1000', name: 'Pipeline Empire', desc: 'Connect 1000 pipes', check: s => s.totalPipes >= 1000 },
  { id: 'pipes_5000', name: 'Pipe Colossus', desc: 'Connect 5000 pipes', check: s => s.totalPipes >= 5000 },
  { id: 'speed_10', name: 'Blitz Runner', desc: 'Complete level in under 10s', check: s => s.fastestClear < 10 && s.fastestClear > 0 },
  { id: 'perfect_5', name: 'Precision Expert', desc: '5 perfect levels', check: s => s.perfectLevels >= 5 },
  { id: 'perfect_10', name: 'Precision Master', desc: '10 perfect levels', check: s => s.perfectLevels >= 10 },
  { id: 'endless_50', name: 'Endless Veteran', desc: 'Clear 50 endless levels', check: s => s.endlessClears >= 50 },
  { id: 'daily_14', name: 'Daily Devotee', desc: 'Complete 14 daily challenges', check: s => s.dailyDone >= 14 },
  { id: 'daily_30', name: 'Monthly Master', desc: 'Complete 30 daily challenges', check: s => s.dailyDone >= 30 },
  { id: 'games_100', name: 'Century Player', desc: 'Play 100 games', check: s => s.gamesPlayed >= 100 },
  { id: 'locks_used', name: 'Locksmith', desc: 'Lock 10 pipes', check: s => s.locksUsed >= 10 },
  { id: 'reveals_used', name: 'Oracle', desc: 'Use reveal 5 times', check: s => s.revealsUsed >= 5 },
  { id: 'no_powerup', name: 'Purist', desc: 'Win 5 levels without power-ups', check: s => s.noPowerupWins >= 5 },
  { id: 'level_30', name: 'Level 30', desc: 'Reach player level 30', check: s => s.level >= 30 },
  { id: 'level_40', name: 'Level 40', desc: 'Reach player level 40', check: s => s.level >= 40 },
  { id: 'two_hundred_flows', name: 'Flow Emperor', desc: 'Complete 200 levels', check: s => s.levelClears >= 200 },
  { id: 'five_hundred_flows', name: 'Flow Deity', desc: 'Complete 500 levels', check: s => s.levelClears >= 500 },
  // Round 4 achievements
  { id: 'star_collector_10', name: 'Star Collector', desc: 'Earn 10 total stars', check: s => s.totalStars >= 10 },
  { id: 'star_collector_50', name: 'Star Hoarder', desc: 'Earn 50 total stars', check: s => s.totalStars >= 50 },
  { id: 'star_collector_100', name: 'Star Emperor', desc: 'Earn 100 total stars', check: s => s.totalStars >= 100 },
  { id: 'three_star_5', name: 'Triple Threat', desc: 'Get 3 stars on 5 levels', check: s => s.threeStarLevels >= 5 },
  { id: 'three_star_20', name: 'Perfectionist', desc: 'Get 3 stars on 20 levels', check: s => s.threeStarLevels >= 20 },
  { id: 'streak_5', name: 'Hot Streak', desc: 'Win 5 levels in a row', check: s => s.longestStreak >= 5 },
  { id: 'streak_10', name: 'Unstoppable', desc: 'Win 10 levels in a row', check: s => s.longestStreak >= 10 },
  { id: 'streak_25', name: 'Streak Legend', desc: 'Win 25 levels in a row', check: s => s.longestStreak >= 25 },
  { id: 'puzzle_5', name: 'Puzzle Solver', desc: 'Clear 5 puzzle levels', check: s => s.puzzleClears >= 5 },
  { id: 'puzzle_20', name: 'Puzzle Expert', desc: 'Clear 20 puzzle levels', check: s => s.puzzleClears >= 20 },
  { id: 'practice_10', name: 'Dedicated Learner', desc: 'Clear 10 practice levels', check: s => s.practiceClears >= 10 },
  { id: 'moves_5000', name: 'Pipe Wizard', desc: 'Make 5000 total moves', check: s => s.totalMoves >= 5000 },
  { id: 'play_time_1h', name: 'Time Invested', desc: 'Play for 1 hour total', check: s => s.playTime >= 3600 },
  { id: 'play_time_5h', name: 'Pipe Addict', desc: 'Play for 5 hours total', check: s => s.playTime >= 18000 },
  { id: 'speed_chain_10', name: 'Speed Demon Chain', desc: '10 levels under 60s each', check: s => s.speedChain >= 10 },
  { id: 'all_skins', name: 'Collector', desc: 'Unlock all 8 pipe skins', check: s => s.skinsUnlocked >= 8 },
  { id: 'campaign_all', name: 'Campaign Legend', desc: 'Complete all campaign zones', check: s => s.campaignLevel >= 36 },
  { id: 'daily_60', name: 'Daily Devotion', desc: 'Complete 60 daily challenges', check: s => s.dailyDone >= 60 },
  { id: 'endless_100', name: 'Endless Legend', desc: 'Clear 100 endless levels', check: s => s.endlessClears >= 100 },
  { id: 'pipes_10000', name: 'Pipe Universe', desc: 'Connect 10000 pipes', check: s => s.totalPipes >= 10000 },
];

interface CareerStats {
  gamesPlayed: number; levelClears: number; totalScore: number; bestScore: number;
  totalMoves: number; totalPipes: number; bestCombo: number; playTime: number;
  perfectLevels: number; level: number; xp: number; fastestClear: number;
  dailyDone: number; zenClears: number; timedWins: number; endlessClears: number;
  campaignLevel: number; skinsUnlocked: number; noMistakeLevels: number; speedChain: number;
  modesPlayed: Set<string>; themesUsed: Set<string>;
  selectedSkin: number; selectedTheme: number;
  // Round 3 additions
  locksUsed: number; revealsUsed: number; noPowerupWins: number;
  endlessHighScore: number; endlessBestLevel: number;
  autoLockEnabled: boolean;
  // Round 4 additions
  colorblindMode: boolean;
  totalStars: number;
  threeStarLevels: number;
  puzzleClears: number;
  practiceClears: number;
  longestStreak: number; // consecutive wins
  currentStreak: number;
  bestModeTimes: Record<string, number>; // personal best time per mode
  bestModeScores: Record<string, number>; // personal best score per mode
}

const LEVEL_TITLES = ['Novice', 'Apprentice', 'Journeyman', 'Plumber', 'Pipe Fitter', 'Flow Master',
  'Pipeline Pro', 'Hydro Expert', 'Flux Adept', 'Flow Sage', 'Pipe Lord', 'Flux Master',
  'Hydro Sage', 'Flow Emperor', 'Pipeline God', 'Quantum Flow', 'Neon Master', 'Flux Lord',
  'Omega Flow', 'NEON GOD'];

function getLevelTitle(lvl: number): string {
  const idx = Math.min(Math.floor((lvl - 1) / 2.5), LEVEL_TITLES.length - 1);
  return LEVEL_TITLES[idx];
}

function xpForLevel(lvl: number): number { return 100 + 50 * lvl; }

// Seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function dateSeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// ============================================================
// AUDIO MANAGER
// ============================================================

class AudioManager {
  private ctx: AudioContext | null = null;
  masterVol = 1; sfxVol = 1; musicVol = 1;
  private drone: OscillatorNode[] = [];
  private droneGain: GainNode | null = null;
  private musicStarted = false;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  playSfx(type: string, pitchVar = 0.08) {
    const ctx = this.getCtx();
    const vol = this.masterVol * this.sfxVol * 0.15;
    if (vol <= 0) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    g.connect(ctx.destination);
    const pm = 1 + (Math.random() - 0.5) * pitchVar * 2;

    const osc = (freq: number, waveType: OscillatorType, dur: number) => {
      const o = ctx.createOscillator();
      o.type = waveType; o.frequency.value = freq * pm;
      o.connect(g); o.start(); o.stop(ctx.currentTime + dur);
    };

    switch (type) {
      case 'rotate': osc(880, 'sine', 0.08); osc(1100, 'triangle', 0.06); break;
      case 'connect': {
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(vol * 1.2, ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        g2.connect(ctx.destination);
        [660, 880, 1100, 1320].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'sine'; o.frequency.value = f * pm;
          o.connect(g2); o.start(ctx.currentTime + i * 0.06); o.stop(ctx.currentTime + i * 0.06 + 0.12);
        });
        break;
      }
      case 'flow': osc(440, 'sine', 0.2); osc(550, 'triangle', 0.15); break;
      case 'complete': {
        [523, 659, 784, 1047, 1318].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'sine'; o.frequency.value = f;
          o.connect(g); o.start(ctx.currentTime + i * 0.08); o.stop(ctx.currentTime + i * 0.08 + 0.2);
        });
        break;
      }
      case 'fail': osc(330, 'sawtooth', 0.2); osc(220, 'sawtooth', 0.25); break;
      case 'click': osc(1200, 'sine', 0.04); break;
      case 'countdown': osc(660, 'sine', 0.1); break;
      case 'go': osc(880, 'sine', 0.15); osc(1100, 'sine', 0.1); break;
      case 'achievement': {
        [880, 1100, 1320, 1540, 1760].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'sine'; o.frequency.value = f;
          o.connect(g); o.start(ctx.currentTime + i * 0.06); o.stop(ctx.currentTime + i * 0.06 + 0.15);
        });
        break;
      }
      case 'combo': osc(660 + 110 * Math.random(), 'triangle', 0.1); osc(880, 'triangle', 0.08); break;
      case 'levelup': {
        [440, 554, 659, 784, 880, 1047].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'sine'; o.frequency.value = f;
          o.connect(g); o.start(ctx.currentTime + i * 0.07); o.stop(ctx.currentTime + i * 0.07 + 0.2);
        });
        break;
      }
      case 'gameStart': {
        [440, 554, 659, 880].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'triangle'; o.frequency.value = f;
          o.connect(g); o.start(ctx.currentTime + i * 0.08); o.stop(ctx.currentTime + i * 0.08 + 0.15);
        });
        break;
      }
      case 'gameOver': {
        [880, 659, 554, 440].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'triangle'; o.frequency.value = f;
          o.connect(g); o.start(ctx.currentTime + i * 0.1); o.stop(ctx.currentTime + i * 0.1 + 0.2);
        });
        break;
      }
    }
  }

  startMusic() {
    if (this.musicStarted) return;
    this.musicStarted = true;
    const ctx = this.getCtx();
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = this.masterVol * this.musicVol * 0.04;
    this.droneGain.connect(ctx.destination);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.15; lfoGain.gain.value = 3;
    lfo.connect(lfoGain);

    const makeOsc = (freq: number, type: OscillatorType) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 400;
      lfoGain.connect(f.frequency);
      o.connect(f); f.connect(this.droneGain!);
      o.start(); this.drone.push(o);
    };
    makeOsc(55, 'sine'); makeOsc(82.5, 'triangle'); makeOsc(110, 'sine');
    lfo.start();
  }

  updateMusicVolume() {
    if (this.droneGain) this.droneGain.gain.value = this.masterVol * this.musicVol * 0.04;
  }
}

// ============================================================
// PARTICLE SYSTEM
// ============================================================

interface Particle {
  mesh: Mesh;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  active: boolean;
}

class ParticlePool {
  particles: Particle[] = [];
  private scene: any;

  constructor(scene: any, count: number) {
    this.scene = scene;
    const geo = new SphereGeometry(0.008, 4, 4);
    for (let i = 0; i < count; i++) {
      const mat = new MeshBasicMaterial({ color: 0x00ffff, transparent: true, blending: AdditiveBlending });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.particles.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, active: false });
    }
  }

  burst(x: number, y: number, z: number, color: number, count: number) {
    let spawned = 0;
    for (const p of this.particles) {
      if (p.active || spawned >= count) continue;
      p.active = true; p.mesh.visible = true;
      p.mesh.position.set(x, y, z);
      (p.mesh.material as MeshBasicMaterial).color.setHex(color);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      p.vx = Math.cos(angle) * speed * (0.5 + Math.random());
      p.vy = 1 + Math.random() * 2;
      p.vz = Math.sin(angle) * speed * (0.5 + Math.random());
      p.life = 0; p.maxLife = 0.6 + Math.random() * 0.4;
      spawned++;
    }
  }

  update(dt: number) {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.active = false; p.mesh.visible = false; continue; }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 4 * dt;
      (p.mesh.material as MeshBasicMaterial).opacity = 1 - p.life / p.maxLife;
    }
  }
}

// ============================================================
// GAME STATE MANAGER
// ============================================================

class GameStateManager {
  state: GameState = 'title';
  mode: GameMode = 'campaign';
  difficulty: Difficulty = 'medium';
  grid: CellData[][] = [];
  gridSize = 7;
  sourcePos: [number, number] = [0, 0];
  drainPos: [number, number] = [0, 0];
  score = 0;
  moves = 0;
  minMoves = 0;
  timer = 0;
  timeLimit = 0;
  combo = 0;
  maxCombo = 0;
  comboTimer = 0;
  level = 1;
  countdownVal = 3;
  connectedPipes = 0;
  totalPipesInPath = 0;
  isComplete = false;
  flowAnimProgress = 0;

  // Undo system
  moveHistory: MoveEntry[] = [];
  hintsUsed = 0;
  undosUsed = 0;
  freezeTimer = 0;

  // Solution tracking (stores solved pipe types for hints/reveal)
  solvedGrid: PipeType[][] = [];

  // Flow particles along connected path
  flowParticles: { mesh: Mesh; pathIdx: number; t: number; speed: number }[] = [];
  connectedPath: [number, number][] = [];

  // Grid 3D
  gridGroup = new Group();
  cellMeshes: (Group | null)[][] = [];
  cellSize = 0.12;
  gridOffset = new Vector3();

  // Hover tracking
  hoveredCell: [number, number] | null = null;

  // Puzzle mode
  moveLimit = 0; // 0 = unlimited

  // Victory sequence
  victoryPhase = 0; // 0 = not playing, 1+ = chain glow step
  victoryTimer = 0;

  // Entrance animation
  entranceActive = false;
  entranceTimer = 0;

  // Stats
  stats: CareerStats;
  unlockedAchievements = new Set<string>();
  leaderboard: { score: number; mode: string; level: number; date: string }[] = [];

  constructor() {
    this.stats = this.loadStats();
    this.unlockedAchievements = new Set(JSON.parse(localStorage.getItem('np_achievements') || '[]'));
    this.leaderboard = JSON.parse(localStorage.getItem('np_leaderboard') || '[]');
  }

  loadStats(): CareerStats {
    const raw = localStorage.getItem('np_stats');
    if (raw) {
      const d = JSON.parse(raw);
      d.modesPlayed = new Set(d.modesPlayed || []);
      d.themesUsed = new Set(d.themesUsed || []);
      // Backwards compat for round 3 fields
      d.locksUsed = d.locksUsed || 0;
      d.revealsUsed = d.revealsUsed || 0;
      d.noPowerupWins = d.noPowerupWins || 0;
      d.endlessHighScore = d.endlessHighScore || 0;
      d.endlessBestLevel = d.endlessBestLevel || 0;
      d.autoLockEnabled = d.autoLockEnabled || false;
      // Round 4 compat
      d.colorblindMode = d.colorblindMode || false;
      d.totalStars = d.totalStars || 0;
      d.threeStarLevels = d.threeStarLevels || 0;
      d.puzzleClears = d.puzzleClears || 0;
      d.practiceClears = d.practiceClears || 0;
      d.longestStreak = d.longestStreak || 0;
      d.currentStreak = d.currentStreak || 0;
      d.bestModeTimes = d.bestModeTimes || {};
      d.bestModeScores = d.bestModeScores || {};
      return d;
    }
    return {
      gamesPlayed: 0, levelClears: 0, totalScore: 0, bestScore: 0,
      totalMoves: 0, totalPipes: 0, bestCombo: 0, playTime: 0,
      perfectLevels: 0, level: 1, xp: 0, fastestClear: 0,
      dailyDone: 0, zenClears: 0, timedWins: 0, endlessClears: 0,
      campaignLevel: 0, skinsUnlocked: 1, noMistakeLevels: 0, speedChain: 0,
      modesPlayed: new Set(), themesUsed: new Set(),
      selectedSkin: 0, selectedTheme: 0,
      locksUsed: 0, revealsUsed: 0, noPowerupWins: 0,
      endlessHighScore: 0, endlessBestLevel: 0,
      autoLockEnabled: false,
      colorblindMode: false,
      totalStars: 0, threeStarLevels: 0,
      puzzleClears: 0, practiceClears: 0,
      longestStreak: 0, currentStreak: 0,
      bestModeTimes: {}, bestModeScores: {},
    };
  }

  saveStats() {
    const d: any = { ...this.stats };
    d.modesPlayed = [...this.stats.modesPlayed];
    d.themesUsed = [...this.stats.themesUsed];
    localStorage.setItem('np_stats', JSON.stringify(d));
    localStorage.setItem('np_achievements', JSON.stringify([...this.unlockedAchievements]));
    localStorage.setItem('np_leaderboard', JSON.stringify(this.leaderboard.slice(0, 20)));
  }

  generateGrid(size: number, rng: () => number) {
    this.gridSize = size;
    this.grid = [];
    this.cellMeshes = [];
    this.solvedGrid = [];
    this.moveHistory = [];
    this.hintsUsed = 0;
    this.undosUsed = 0;
    this.freezeTimer = 0;
    this.hoveredCell = null;
    this.connectedPath = [];

    // Initialize empty grid
    for (let y = 0; y < size; y++) {
      this.grid[y] = [];
      this.cellMeshes[y] = [];
      this.solvedGrid[y] = [];
      for (let x = 0; x < size; x++) {
        this.grid[y][x] = {
          pipeType: PipeType.STRAIGHT_H,
          isSource: false, isDrain: false, isLocked: false,
          isConnected: false, isBlocked: false, flowProgress: 0, mesh: null, highlightMesh: null,
          rotAnim: 0, rotDir: 0, entranceDelay: 0, entranceProgress: 0,
        };
        this.cellMeshes[y][x] = null;
        this.solvedGrid[y][x] = PipeType.STRAIGHT_H;
      }
    }

    // Place source and drain
    this.sourcePos = [0, Math.floor(rng() * size)];
    this.drainPos = [size - 1, Math.floor(rng() * size)];
    this.grid[this.sourcePos[1]][this.sourcePos[0]].isSource = true;
    this.grid[this.drainPos[1]][this.drainPos[0]].isDrain = true;

    // Generate a guaranteed path from source to drain using random walk
    const path: [number, number][] = [];
    let cx = this.sourcePos[0], cy = this.sourcePos[1];
    const visited = new Set<string>();
    visited.add(`${cx},${cy}`);
    path.push([cx, cy]);

    while (cx !== this.drainPos[0] || cy !== this.drainPos[1]) {
      const dirs: [number, number][] = [];
      // Bias toward drain
      if (cx < this.drainPos[0]) dirs.push([1, 0], [1, 0]); // double weight right
      if (cx > this.drainPos[0]) dirs.push([-1, 0]);
      if (cy < this.drainPos[1]) dirs.push([0, 1]);
      if (cy > this.drainPos[1]) dirs.push([0, -1]);
      // Add some randomness
      if (cy > 0 && !visited.has(`${cx},${cy - 1}`)) dirs.push([0, -1]);
      if (cy < size - 1 && !visited.has(`${cx},${cy + 1}`)) dirs.push([0, 1]);
      if (cx < size - 1 && !visited.has(`${cx + 1},${cy}`)) dirs.push([1, 0]);

      if (dirs.length === 0) break; // shouldn't happen with bias

      const [dx, dy] = dirs[Math.floor(rng() * dirs.length)];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      if (visited.has(`${nx},${ny}`)) continue;

      cx = nx; cy = ny;
      visited.add(`${cx},${cy}`);
      path.push([cx, cy]);
    }

    // Assign correct pipe types for the path
    for (let i = 0; i < path.length; i++) {
      const [px, py] = path[i];
      const connections: Direction[] = [];
      if (i > 0) {
        const [prevX, prevY] = path[i - 1];
        if (prevX < px) connections.push('left');
        if (prevX > px) connections.push('right');
        if (prevY < py) connections.push('up');
        if (prevY > py) connections.push('down');
      }
      if (i < path.length - 1) {
        const [nextX, nextY] = path[i + 1];
        if (nextX > px) connections.push('right');
        if (nextX < px) connections.push('left');
        if (nextY > py) connections.push('down');
        if (nextY < py) connections.push('up');
      }

      // Find matching pipe type
      const solvedType = this.findPipeType(connections);
      this.grid[py][px].pipeType = solvedType;
    }

    // Fill remaining cells with random pipes
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (visited.has(`${x},${y}`)) continue;
        const types = [PipeType.STRAIGHT_H, PipeType.STRAIGHT_V, PipeType.ELBOW_UR, PipeType.ELBOW_RD,
          PipeType.ELBOW_DL, PipeType.ELBOW_LU, PipeType.T_URD, PipeType.T_RDL, PipeType.T_DLU, PipeType.T_LUR, PipeType.CROSS];
        this.grid[y][x].pipeType = types[Math.floor(rng() * types.length)];
      }
    }

    // Store solved state before scrambling
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        this.solvedGrid[y][x] = this.grid[y][x].pipeType;
      }
    }

    // Now scramble all non-source/drain pipes by rotating randomly
    this.minMoves = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cell = this.grid[y][x];
        if (cell.isSource || cell.isDrain) { cell.isLocked = true; continue; }
        if (cell.isBlocked) continue;
        const rotations = Math.floor(rng() * 4);
        for (let r = 0; r < rotations; r++) {
          cell.pipeType = ROTATE_CW[cell.pipeType];
        }
        if (rotations > 0) this.minMoves++;
        // Staggered entrance: delay based on distance from center
        const cx = size / 2, cy = size / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        cell.entranceDelay = dist * 0.06 + Math.random() * 0.05;
        cell.entranceProgress = 0;
      }
    }

    this.totalPipesInPath = path.length;
  }

  // Get a hint: find a pipe that's not in its solved position
  getHintCell(): [number, number] | null {
    const unsolved: [number, number][] = [];
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const cell = this.grid[y][x];
        if (cell.isLocked) continue;
        if (cell.pipeType !== this.solvedGrid[y][x]) {
          unsolved.push([x, y]);
        }
      }
    }
    if (unsolved.length === 0) return null;
    return unsolved[Math.floor(Math.random() * unsolved.length)];
  }

  // Undo last move
  undoLastMove(): MoveEntry | null {
    const move = this.moveHistory.pop();
    if (!move) return null;
    this.grid[move.y][move.x].pipeType = move.prevType;
    this.moves = Math.max(0, this.moves - 1);
    return move;
  }

  findPipeType(connections: Direction[]): PipeType {
    const sorted = connections.sort();
    const key = sorted.join(',');
    for (const [pt, dirs] of Object.entries(PIPE_CONNECTIONS)) {
      if (dirs.slice().sort().join(',') === key) return Number(pt) as PipeType;
    }
    // Default: if only one connection, use a straight pipe
    if (connections.length === 1) {
      if (connections[0] === 'left' || connections[0] === 'right') return PipeType.STRAIGHT_H;
      return PipeType.STRAIGHT_V;
    }
    return PipeType.CROSS;
  }

  checkConnections(): number {
    // BFS from source following pipe connections
    const visited = new Set<string>();
    const queue: [number, number][] = [this.sourcePos];
    visited.add(`${this.sourcePos[0]},${this.sourcePos[1]}`);
    let connCount = 0;

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const cell = this.grid[cy][cx];
      const connections = PIPE_CONNECTIONS[cell.pipeType];
      cell.isConnected = true;
      connCount++;

      for (const dir of connections) {
        const [dx, dy] = DIR_OFFSET[dir];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= this.gridSize || ny < 0 || ny >= this.gridSize) continue;
        if (visited.has(`${nx},${ny}`)) continue;
        const neighbor = this.grid[ny][nx];
        const neighborConns = PIPE_CONNECTIONS[neighbor.pipeType];
        // Check if neighbor connects back
        if (neighborConns.includes(OPPOSITE[dir])) {
          visited.add(`${nx},${ny}`);
          queue.push([nx, ny]);
        }
      }
    }

    // Mark unvisited as disconnected
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (!visited.has(`${x},${y}`)) {
          this.grid[y][x].isConnected = false;
          this.grid[y][x].flowProgress = 0;
        }
      }
    }

    this.connectedPipes = connCount;
    this.isComplete = visited.has(`${this.drainPos[0]},${this.drainPos[1]}`);
    return connCount;
  }
}


// ============================================================
// PIPE MESH BUILDER
// ============================================================

function buildPipeMesh(pipeType: PipeType, skin: PipeSkin, theme: Theme, isSource: boolean, isDrain: boolean, isLocked = false, colorblind = false): Group {
  const g = new Group();
  const baseColor = isSource ? theme.source : isDrain ? theme.drain : isLocked ? 0x4488ff : skin.color;
  const emissiveColor = isSource ? 0x005522 : isDrain ? 0x550000 : isLocked ? 0x002244 : skin.emissive;
  const glowColor = isSource ? theme.source : isDrain ? theme.drain : isLocked ? 0x4488ff : skin.glowColor;

  const pipeMat = new MeshStandardMaterial({
    color: baseColor, emissive: emissiveColor, emissiveIntensity: 0.5,
    metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.9,
  });
  const wireMat = new LineBasicMaterial({ color: glowColor, transparent: true, opacity: 0.6 });
  const glowMat = new MeshBasicMaterial({
    color: glowColor, transparent: true, opacity: 0.15, blending: AdditiveBlending,
  });

  const connections = PIPE_CONNECTIONS[pipeType];
  const pipeRadius = 0.015;
  const halfCell = 0.05;

  // Draw pipe segments for each connection direction
  for (const dir of connections) {
    let seg: Mesh;
    const segGeo = new CylinderGeometry(pipeRadius, pipeRadius, halfCell, 8);
    seg = new Mesh(segGeo, pipeMat);

    switch (dir) {
      case 'up': seg.position.set(0, 0, -halfCell / 2); seg.rotation.x = Math.PI / 2; break;
      case 'down': seg.position.set(0, 0, halfCell / 2); seg.rotation.x = Math.PI / 2; break;
      case 'left': seg.position.set(-halfCell / 2, 0, 0); seg.rotation.z = Math.PI / 2; break;
      case 'right': seg.position.set(halfCell / 2, 0, 0); seg.rotation.z = Math.PI / 2; break;
    }
    g.add(seg);

    // Edge wireframe
    const edges = new EdgesGeometry(segGeo);
    const wireframe = new LineSegments(edges, wireMat);
    wireframe.position.copy(seg.position);
    wireframe.rotation.copy(seg.rotation);
    g.add(wireframe);
  }

  // Center hub sphere
  const hubGeo = new SphereGeometry(pipeRadius * 1.3, 8, 8);
  const hub = new Mesh(hubGeo, pipeMat);
  g.add(hub);

  // Glow sphere
  const glowGeo = new SphereGeometry(pipeRadius * 2.5, 8, 8);
  const glow = new Mesh(glowGeo, glowMat);
  g.add(glow);

  // Source/drain marker
  if (isSource || isDrain) {
    const markerGeo = new TorusGeometry(pipeRadius * 2, pipeRadius * 0.4, 8, 16);
    const markerMat = new MeshBasicMaterial({
      color: isSource ? theme.source : theme.drain,
      transparent: true, opacity: 0.6, blending: AdditiveBlending,
    });
    const marker = new Mesh(markerGeo, markerMat);
    marker.rotation.x = Math.PI / 2;
    marker.position.y = 0.01;
    g.add(marker);
  }

  // Colorblind mode: add shape indicators for connection count
  if (colorblind) {
    const connCount = connections.length;
    const indicatorMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    if (connCount === 2) {
      // Two connections: small diamond
      const dGeo = new BoxGeometry(0.008, 0.008, 0.008);
      const d = new Mesh(dGeo, indicatorMat);
      d.position.y = 0.02;
      d.rotation.set(Math.PI / 4, 0, Math.PI / 4);
      g.add(d);
    } else if (connCount === 3) {
      // T-pipe: triangle indicator (3 small spheres)
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const sGeo = new SphereGeometry(0.004, 4, 4);
        const s = new Mesh(sGeo, indicatorMat);
        s.position.set(Math.cos(angle) * 0.012, 0.025, Math.sin(angle) * 0.012);
        g.add(s);
      }
    } else if (connCount === 4) {
      // Cross: plus indicator
      const barGeo = new BoxGeometry(0.025, 0.003, 0.005);
      const bar1 = new Mesh(barGeo, indicatorMat);
      bar1.position.y = 0.025;
      g.add(bar1);
      const bar2 = new Mesh(barGeo, indicatorMat);
      bar2.position.y = 0.025;
      bar2.rotation.y = Math.PI / 2;
      g.add(bar2);
    }
  }

  return g;
}

function buildFlowMesh(theme: Theme): Mesh {
  const geo = new SphereGeometry(0.008, 6, 6);
  const mat = new MeshBasicMaterial({
    color: theme.flow, transparent: true, opacity: 0.8, blending: AdditiveBlending,
  });
  return new Mesh(geo, mat);
}

// ============================================================
// ENVIRONMENT BUILDER
// ============================================================

function buildEnvironment(scene: any, theme: Theme) {
  // Floor grid
  const gridSize = 20;
  const gridGeo = new BufferGeometry();
  const positions: number[] = [];
  for (let i = -gridSize; i <= gridSize; i++) {
    positions.push(-gridSize, 0, i, gridSize, 0, i);
    positions.push(i, 0, -gridSize, i, 0, gridSize);
  }
  gridGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const gridMat = new LineBasicMaterial({ color: theme.grid, transparent: true, opacity: 0.15 });
  const gridLines = new LineSegments(gridGeo, gridMat);
  scene.add(gridLines);

  // Ceiling grid
  const ceiling = gridLines.clone();
  ceiling.position.y = 4;
  scene.add(ceiling);

  // Fog
  scene.fog = new Fog(theme.fog, 5, 25);
  scene.background = new Color(theme.bg);

  // Lights
  const ambientLight = new AmbientLight(0xffffff, 0.15);
  scene.add(ambientLight);
  const dirLight = new DirectionalLight(0xffffff, 0.3);
  dirLight.position.set(2, 4, 2);
  scene.add(dirLight);
  const accentLight1 = new PointLight(theme.accent, 1.5, 10);
  accentLight1.position.set(-2, 2.5, -2);
  scene.add(accentLight1);
  const accentLight2 = new PointLight(theme.grid, 1.0, 8);
  accentLight2.position.set(2, 2.5, 2);
  scene.add(accentLight2);

  // Floating wireframe decorations
  const decoGroup = new Group();
  const decoGeos = [new TorusGeometry(0.15, 0.03, 8, 16), new BoxGeometry(0.2, 0.2, 0.2), new SphereGeometry(0.12, 8, 8), new CylinderGeometry(0.08, 0.08, 0.25, 8)];
  for (let i = 0; i < 14; i++) {
    const geo = decoGeos[i % decoGeos.length];
    const edges = new EdgesGeometry(geo);
    const mat = new LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.2 + Math.random() * 0.2 });
    const deco = new LineSegments(edges, mat);
    deco.position.set((Math.random() - 0.5) * 8, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 8 - 2);
    deco.userData = { rotSpeed: 0.2 + Math.random() * 0.5, bobSpeed: 0.3 + Math.random() * 0.4, bobAmp: 0.05 + Math.random() * 0.1, baseY: deco.position.y };
    decoGroup.add(deco);
  }
  scene.add(decoGroup);

  // Ambient floating particles
  const ambParticles = new Group();
  const pGeo = new SphereGeometry(0.005, 4, 4);
  for (let i = 0; i < 40; i++) {
    const mat = new MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.3, blending: AdditiveBlending });
    const p = new Mesh(pGeo, mat);
    p.position.set((Math.random() - 0.5) * 10, Math.random() * 3.5, (Math.random() - 0.5) * 10 - 2);
    p.userData = { driftX: (Math.random() - 0.5) * 0.1, driftY: (Math.random() - 0.5) * 0.05, pulseSpeed: 0.5 + Math.random() };
    ambParticles.add(p);
  }
  scene.add(ambParticles);

  return { decoGroup, ambParticles, gridLines, ceiling };
}

// ============================================================
// UI SYSTEM
// ============================================================

class GameUISystem extends createSystem({
  titlePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/title.json')] },
  modePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/modeselect.json')] },
  diffPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/difficulty.json')] },
  hudPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/hud.json')] },
  pausePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/pause.json')] },
  gameoverPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/gameover.json')] },
  lbPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/leaderboard.json')] },
  achPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/achvlist.json')] },
  statsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/stats.json')] },
  settingsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/settings.json')] },
  helpPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/help.json')] },
  toastPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/toast.json')] },
  countdownPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/countdown.json')] },
  skinsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/skins.json')] },
  flowbarPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/flowbar.json')] },
  toolbarPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/toolbar.json')] },
  campaignPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/campaign.json')] },
}) {
  private game!: GameStateManager;
  private audio!: AudioManager;
  private panelEntities: Map<string, any> = new Map();
  private docs: Map<string, UIKitDocument> = new Map();
  private achPage = 0;
  private toastTimer = 0;
  private toastQueue: string[] = [];

  setRefs(refs: { game: GameStateManager; audio: AudioManager }) {
    this.game = refs.game;
    this.audio = refs.audio;
  }

  private getDoc(entity: any): UIKitDocument | undefined {
    return PanelDocument.data.document[entity.index] as UIKitDocument | undefined;
  }

  private setText(entity: any, id: string, text: string) {
    const doc = this.getDoc(entity);
    (doc?.getElementById(id) as UIKit.Text | undefined)?.setProperties({ text });
  }

  private wireBtn(entity: any, id: string, cb: () => void) {
    const doc = this.getDoc(entity);
    const btn = doc?.getElementById(id) as UIKit.Text | undefined;
    btn?.addEventListener('click', () => { this.audio.playSfx('click'); cb(); });
  }

  init() {
    const wirePanel = (queryName: string, panelName: string, setup: (entity: any) => void) => {
      (this.queries as any)[queryName].subscribe('qualify', (entity: any) => {
        this.panelEntities.set(panelName, entity);
        this.docs.set(panelName, this.getDoc(entity)!);
        setup(entity);
      });
    };

    wirePanel('titlePanel', 'title', (e) => {
      this.wireBtn(e, 'btn-play', () => this.game.state = 'modeselect');
      this.wireBtn(e, 'btn-scores', () => { this.updateLeaderboard(); this.game.state = 'leaderboard'; });
      this.wireBtn(e, 'btn-achievements', () => { this.updateAchievements(); this.game.state = 'achievements'; });
      this.wireBtn(e, 'btn-stats', () => { this.updateStats(); this.game.state = 'stats'; });
      this.wireBtn(e, 'btn-themes', () => { this.updateSkins(); this.game.state = 'skins'; });
      this.wireBtn(e, 'btn-settings', () => this.game.state = 'settings');
      this.wireBtn(e, 'btn-help', () => this.game.state = 'help');
    });

    wirePanel('modePanel', 'modeselect', (e) => {
      const modes: [string, GameMode][] = [
        ['btn-campaign', 'campaign'], ['btn-timed', 'timed'], ['btn-endless', 'endless'],
        ['btn-zen', 'zen'], ['btn-daily', 'daily'], ['btn-speed', 'speed'],
        ['btn-puzzle', 'puzzle'], ['btn-practice', 'practice'],
      ];
      for (const [btnId, mode] of modes) {
        this.wireBtn(e, btnId, () => {
          this.game.mode = mode;
          if (mode === 'campaign') {
            this.updateCampaign();
            this.game.state = 'campaign';
          } else {
            this.game.state = 'difficulty';
          }
        });
      }
      this.wireBtn(e, 'btn-back', () => this.game.state = 'title');
    });

    wirePanel('diffPanel', 'difficulty', (e) => {
      const diffs: [string, Difficulty, number][] = [['btn-easy', 'easy', 5], ['btn-medium', 'medium', 7], ['btn-hard', 'hard', 9]];
      for (const [btnId, diff, size] of diffs) {
        this.wireBtn(e, btnId, () => {
          this.game.difficulty = diff;
          this.game.gridSize = size;
          startGame(this.game, this.audio);
        });
      }
      this.wireBtn(e, 'btn-back', () => this.game.state = 'modeselect');
    });

    wirePanel('hudPanel', 'hud', () => {});
    wirePanel('pausePanel', 'pause', (e) => {
      this.wireBtn(e, 'btn-resume', () => this.game.state = 'playing');
      this.wireBtn(e, 'btn-quit', () => { this.game.state = 'title'; clearGrid(this.game); });
    });

    wirePanel('gameoverPanel', 'gameover', (e) => {
      this.wireBtn(e, 'btn-next', () => {
        if (this.game.mode === 'campaign') this.game.level++;
        startGame(this.game, this.audio);
      });
      this.wireBtn(e, 'btn-rematch', () => startGame(this.game, this.audio));
      this.wireBtn(e, 'btn-menu', () => { this.game.state = 'title'; clearGrid(this.game); });
    });

    wirePanel('lbPanel', 'leaderboard', (e) => {
      this.wireBtn(e, 'btn-back', () => this.game.state = 'title');
    });

    wirePanel('achPanel', 'achievements', (e) => {
      this.wireBtn(e, 'btn-back', () => this.game.state = 'title');
      this.wireBtn(e, 'btn-prev', () => { if (this.achPage > 0) { this.achPage--; this.updateAchievements(); } });
      this.wireBtn(e, 'btn-next-page', () => {
        if ((this.achPage + 1) * 15 < ACHIEVEMENTS.length) { this.achPage++; this.updateAchievements(); }
      });
    });

    wirePanel('statsPanel', 'stats', (e) => {
      this.wireBtn(e, 'btn-back', () => this.game.state = 'title');
    });

    wirePanel('settingsPanel', 'settings', (e) => {
      const volBtns: [string, 'masterVol' | 'sfxVol' | 'musicVol', number][] = [
        ['btn-master-up', 'masterVol', 10], ['btn-master-down', 'masterVol', -10],
        ['btn-sfx-up', 'sfxVol', 10], ['btn-sfx-down', 'sfxVol', -10],
        ['btn-music-up', 'musicVol', 10], ['btn-music-down', 'musicVol', -10],
      ];
      for (const [btnId, prop, delta] of volBtns) {
        this.wireBtn(e, btnId, () => {
          const cur = Math.round(this.audio[prop] * 100);
          this.audio[prop] = Math.max(0, Math.min(100, cur + delta)) / 100;
          this.audio.updateMusicVolume();
          this.updateSettingsDisplay();
        });
      }
      this.wireBtn(e, 'btn-theme-prev', () => {
        this.game.stats.selectedTheme = (this.game.stats.selectedTheme + THEMES.length - 1) % THEMES.length;
        this.updateSettingsDisplay();
        this.game.saveStats();
      });
      this.wireBtn(e, 'btn-theme-next', () => {
        this.game.stats.selectedTheme = (this.game.stats.selectedTheme + 1) % THEMES.length;
        this.updateSettingsDisplay();
        this.game.saveStats();
      });
      this.wireBtn(e, 'btn-autolock', () => {
        this.game.stats.autoLockEnabled = !this.game.stats.autoLockEnabled;
        this.updateSettingsDisplay();
        this.game.saveStats();
        this.showToast(this.game.stats.autoLockEnabled ? 'Auto-lock ON' : 'Auto-lock OFF');
      });
      this.wireBtn(e, 'btn-colorblind', () => {
        this.game.stats.colorblindMode = !this.game.stats.colorblindMode;
        this.updateSettingsDisplay();
        this.game.saveStats();
        this.showToast(this.game.stats.colorblindMode ? 'Colorblind mode ON' : 'Colorblind mode OFF');
      });
      this.wireBtn(e, 'btn-back', () => this.game.state = 'title');
    });

    wirePanel('helpPanel', 'help', (e) => {
      this.wireBtn(e, 'btn-back', () => this.game.state = 'title');
    });

    wirePanel('toastPanel', 'toast', () => {});
    wirePanel('countdownPanel', 'countdown', () => {});
    wirePanel('skinsPanel', 'skins', (e) => {
      for (let i = 0; i < 8; i++) {
        this.wireBtn(e, `skin${i}`, () => {
          if (PIPE_SKINS[i].unlockCheck(this.game.stats)) {
            this.game.stats.selectedSkin = i;
            this.game.saveStats();
            this.updateSkins();
          }
        });
      }
      this.wireBtn(e, 'btn-back', () => this.game.state = 'title');
    });

    wirePanel('flowbarPanel', 'flowbar', () => {});

    wirePanel('toolbarPanel', 'toolbar', (e) => {
      this.wireBtn(e, 'btn-undo', () => {
        if (this.game.state !== 'playing') return;
        const move = this.game.undoLastMove();
        if (move) {
          this.game.undosUsed++;
          rebuildCellMesh(this.game, move.x, move.y);
          this.game.checkConnections();
          updateGridVisuals(this.game);
          this.audio.playSfx('click');
          this.showToast('Move undone');
        }
      });
      this.wireBtn(e, 'btn-hint', () => {
        if (this.game.state !== 'playing') return;
        const cell = this.game.getHintCell();
        if (cell) {
          this.game.hintsUsed++;
          highlightHintCell(this.game, cell[0], cell[1]);
          this.audio.playSfx('click');
          this.showToast('Hint: Check highlighted pipe');
        } else {
          this.showToast('All pipes are correct!');
        }
      });
      this.wireBtn(e, 'btn-freeze', () => {
        if (this.game.state !== 'playing') return;
        if (this.game.mode !== 'timed' && this.game.mode !== 'speed') {
          this.showToast('Freeze only works in timed modes');
          return;
        }
        this.game.freezeTimer = 10;
        this.audio.playSfx('click');
        this.showToast('Timer frozen for 10s!');
      });
      this.wireBtn(e, 'btn-restart', () => {
        if (this.game.state !== 'playing') return;
        startGame(this.game, this.audio);
      });
      this.wireBtn(e, 'btn-lock', () => {
        if (this.game.state !== 'playing') return;
        // Lock a correctly-placed pipe: find connected pipes that match solved state
        let locked = false;
        for (let y = 0; y < this.game.gridSize; y++) {
          for (let x = 0; x < this.game.gridSize; x++) {
            const cell = this.game.grid[y][x];
            if (cell.isLocked) continue;
            if (cell.pipeType === this.game.solvedGrid[y][x]) {
              cell.isLocked = true;
              locked = true;
              this.game.stats.locksUsed++;
              rebuildCellMesh(this.game, x, y);
              this.audio.playSfx('connect');
              this.showToast('Pipe locked in place!');
              // Particle burst
              const pos = getCellWorldPos(this.game, x, y);
              particlesRef.burst(pos.x, pos.y, pos.z, 0x4488ff, 8);
              this.game.saveStats();
              return;
            }
          }
        }
        if (!locked) this.showToast('No correct pipes to lock');
      });
      this.wireBtn(e, 'btn-reveal', () => {
        if (this.game.state !== 'playing') return;
        // Reveal: briefly show solution overlay
        this.game.stats.revealsUsed++;
        this.game.saveStats();
        this.showToast('Solution revealed for 2s!');
        this.audio.playSfx('click');
        revealSolution(this.game, true);
        setTimeout(() => revealSolution(this.game, false), 2000);
      });
    });

    wirePanel('campaignPanel', 'campaign', (e) => {
      for (let i = 0; i < 6; i++) {
        const zone = CAMPAIGN_ZONES[i];
        this.wireBtn(e, `btn-zone${i + 1}`, () => {
          const zoneStart = i * 6 + 1;
          const unlocked = i === 0 || this.game.stats.campaignLevel >= (i * 6);
          if (!unlocked) {
            this.showToast(`Complete Zone ${i} first!`);
            return;
          }
          this.game.level = Math.max(zoneStart, Math.min(this.game.stats.campaignLevel + 1, zoneStart + zone.levels - 1));
          this.game.mode = 'campaign';
          // Set grid size based on zone
          const zoneLevel = this.game.level - zoneStart;
          this.game.gridSize = zone.gridMin + Math.floor(zoneLevel * (zone.gridMax - zone.gridMin) / Math.max(1, zone.levels - 1));
          startGame(this.game, this.audio);
        });
      }
      this.wireBtn(e, 'btn-back', () => this.game.state = 'modeselect');
    });
  }

  showToast(msg: string) {
    this.toastQueue.push(msg);
  }

  private updateSettingsDisplay() {
    const e = this.panelEntities.get('settings');
    if (!e) return;
    this.setText(e, 'master-vol', `${Math.round(this.audio.masterVol * 100)}`);
    this.setText(e, 'sfx-vol', `${Math.round(this.audio.sfxVol * 100)}`);
    this.setText(e, 'music-vol', `${Math.round(this.audio.musicVol * 100)}`);
    this.setText(e, 'theme-name', THEMES[this.game.stats.selectedTheme].name);
    this.setText(e, 'autolock-label', `Auto-Lock: ${this.game.stats.autoLockEnabled ? 'ON' : 'OFF'}`);
    this.setText(e, 'colorblind-label', `Colorblind: ${this.game.stats.colorblindMode ? 'ON' : 'OFF'}`);
  }

  private updateLeaderboard() {
    const e = this.panelEntities.get('leaderboard');
    if (!e) return;
    for (let i = 0; i < 10; i++) {
      const entry = this.game.leaderboard[i];
      this.setText(e, `row${i}`, entry ? `${i + 1}. ${entry.score} - ${entry.mode} - ${entry.date}` : `${i + 1}. ---`);
    }
  }

  private updateAchievements() {
    const e = this.panelEntities.get('achievements');
    if (!e) return;
    const start = this.achPage * 15;
    for (let i = 0; i < 15; i++) {
      const ach = ACHIEVEMENTS[start + i];
      if (ach) {
        const unlocked = this.game.unlockedAchievements.has(ach.id);
        this.setText(e, `ach${i}`, `${unlocked ? '[X]' : '[ ]'} ${ach.name}: ${ach.desc}`);
      } else {
        this.setText(e, `ach${i}`, '');
      }
    }
    const totalPages = Math.ceil(ACHIEVEMENTS.length / 15);
    this.setText(e, 'page-label', `${this.achPage + 1}/${totalPages}`);
  }

  private updateStats() {
    const e = this.panelEntities.get('stats');
    if (!e) return;
    const s = this.game.stats;
    const labels = [
      `Games Played: ${s.gamesPlayed}`, `Levels Cleared: ${s.levelClears}`,
      `Total Score: ${s.totalScore}`, `Best Score: ${s.bestScore}`,
      `Total Moves: ${s.totalMoves}`, `Total Pipes: ${s.totalPipes}`,
      `Best Combo: x${s.bestCombo}`,
      `Play Time: ${Math.floor(s.playTime / 60)}:${String(Math.floor(s.playTime) % 60).padStart(2, '0')}`,
      `Perfect Levels: ${s.perfectLevels}`,
      `Level: ${s.level} (${getLevelTitle(s.level)})`,
      `Stars: ${s.totalStars} (${s.threeStarLevels} perfect)`,
      `Win Streak: ${s.currentStreak} (Best: ${s.longestStreak})`,
      `Endless Best: Lvl ${s.endlessBestLevel}`,
      `Achievements: ${this.game.unlockedAchievements.size}/${ACHIEVEMENTS.length}`,
    ];
    labels.forEach((l, i) => this.setText(e, `stat${i}`, l));
    // Extra stat rows
    this.setText(e, 'stat12', `Endless Best: Lvl ${s.endlessBestLevel}`);
    this.setText(e, 'stat13', `Achievements: ${this.game.unlockedAchievements.size}/${ACHIEVEMENTS.length}`);
  }

  private updateSkins() {
    const e = this.panelEntities.get('skins');
    if (!e) return;
    for (let i = 0; i < 8; i++) {
      const skin = PIPE_SKINS[i];
      const unlocked = skin.unlockCheck(this.game.stats);
      const selected = this.game.stats.selectedSkin === i;
      const prefix = selected ? '[*]' : unlocked ? '[ ]' : '[?]';
      this.setText(e, `skin${i}`, `${prefix} ${skin.name} (${skin.unlockCondition})`);
    }
  }

  private updateCampaign() {
    const e = this.panelEntities.get('campaign');
    if (!e) return;
    const currentZone = Math.floor(this.game.stats.campaignLevel / 6);
    const levelInZone = (this.game.stats.campaignLevel % 6);
    const zone = CAMPAIGN_ZONES[Math.min(currentZone, 5)];
    this.setText(e, 'zone-name', `Zone ${currentZone + 1}: ${zone.name}`);
    this.setText(e, 'zone-desc', zone.desc);
    this.setText(e, 'zone-progress', `Level ${levelInZone + 1} / ${zone.levels}`);

    // Update zone button labels to show progress
    for (let i = 0; i < 6; i++) {
      const z = CAMPAIGN_ZONES[i];
      const zoneStart = i * 6;
      const cleared = Math.max(0, Math.min(z.levels, this.game.stats.campaignLevel - zoneStart));
      const unlocked = i === 0 || this.game.stats.campaignLevel >= zoneStart;
      const label = unlocked ? `Zone ${i + 1}: ${z.name} (${cleared}/${z.levels})` : `Zone ${i + 1}: LOCKED`;
      this.setText(e, `btn-zone${i + 1}`, label);
    }
  }

  update(delta: number) {
    // Panel visibility
    const panels: [string, GameState[]][] = [
      ['title', ['title']], ['modeselect', ['modeselect']], ['difficulty', ['difficulty']],
      ['hud', ['playing', 'paused']], ['pause', ['paused']], ['gameover', ['gameover']],
      ['leaderboard', ['leaderboard']], ['achievements', ['achievements']],
      ['stats', ['stats']], ['settings', ['settings']], ['help', ['help']],
      ['countdown', ['countdown']], ['skins', ['skins']], ['flowbar', ['playing']],
      ['toolbar', ['playing']], ['campaign', ['campaign']],
    ];
    for (const [name, states] of panels) {
      const e = this.panelEntities.get(name);
      if (e?.object3D) e.object3D.visible = states.includes(this.game.state);
    }

    // Toast handling
    const toastE = this.panelEntities.get('toast');
    if (toastE?.object3D) {
      if (this.toastTimer > 0) {
        this.toastTimer -= delta;
        toastE.object3D.visible = true;
        if (this.toastTimer <= 0) toastE.object3D.visible = false;
      } else if (this.toastQueue.length > 0) {
        const msg = this.toastQueue.shift()!;
        this.setText(toastE, 'toast-text', msg);
        this.toastTimer = 2;
        toastE.object3D.visible = true;
      } else {
        toastE.object3D.visible = false;
      }
    }

    // Update HUD
    if (this.game.state === 'playing') {
      const hudE = this.panelEntities.get('hud');
      if (hudE) {
        this.setText(hudE, 'score-label', `Score: ${this.game.score}`);
        this.setText(hudE, 'moves-label', `Moves: ${this.game.moves}`);
        this.setText(hudE, 'level-label', `Level ${this.game.level}`);
        const min = Math.floor(this.game.timer / 60);
        const sec = Math.floor(this.game.timer) % 60;
        this.setText(hudE, 'time-label', `${min}:${String(sec).padStart(2, '0')}`);
        this.setText(hudE, 'combo-label', this.game.combo > 1 ? `x${this.game.combo}` : '');
        this.setText(hudE, 'mode-label', this.game.mode.charAt(0).toUpperCase() + this.game.mode.slice(1));
        this.setText(hudE, 'freeze-label', this.game.freezeTimer > 0 ? `FROZEN ${Math.ceil(this.game.freezeTimer)}s` : '');
        // Show move limit for puzzle mode
        if (this.game.moveLimit > 0) {
          const remaining = Math.max(0, this.game.moveLimit - this.game.moves);
          this.setText(hudE, 'moves-label', `Moves: ${this.game.moves}/${this.game.moveLimit} (${remaining} left)`);
        }
      }
      // Flow bar
      const flowE = this.panelEntities.get('flowbar');
      if (flowE) {
        const pct = this.game.totalPipesInPath > 0 ? Math.round((this.game.connectedPipes / this.game.totalPipesInPath) * 100) : 0;
        this.setText(flowE, 'flow-text', `Flow: ${pct}%`);
      }
    }

    // Update title level display
    if (this.game.state === 'title') {
      const titleE = this.panelEntities.get('title');
      if (titleE) {
        this.setText(titleE, 'level-display', `Level ${this.game.stats.level} -- ${getLevelTitle(this.game.stats.level)}`);
      }
    }
  }
}

// ============================================================
// GAME LOGIC SYSTEM
// ============================================================

let worldRef: World;
let gameRef: GameStateManager;
let audioRef: AudioManager;
let uiRef: GameUISystem;
let particlesRef: ParticlePool;
let envRef: ReturnType<typeof buildEnvironment>;
let flowMeshes: Mesh[] = [];

class GameLogicSystem extends createSystem({}) {
  private game!: GameStateManager;
  private audio!: AudioManager;
  private ui!: GameUISystem;
  private particles!: ParticlePool;
  private countdownTimer = 0;
  private raycaster: any = null;

  setRefs(refs: { game: GameStateManager; audio: AudioManager; ui: GameUISystem; particles: ParticlePool }) {
    this.game = refs.game;
    this.audio = refs.audio;
    this.ui = refs.ui;
    this.particles = refs.particles;
  }

  init() {
    // Mouse interaction
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', (e: MouseEvent) => this.handleClick(e, false));
    canvas.addEventListener('contextmenu', (e: MouseEvent) => { e.preventDefault(); this.handleClick(e, true); });
    canvas.addEventListener('mousemove', (e: MouseEvent) => this.handleHover(e));

    // Keyboard
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'p') {
        if (this.game.state === 'playing') this.game.state = 'paused';
        else if (this.game.state === 'paused') this.game.state = 'playing';
      }
      if (e.key === 'r' && this.game.state === 'playing') {
        startGame(this.game, this.audio);
      }
      // Number keys for power-ups
      if (e.key === 'z' && this.game.state === 'playing') {
        const move = this.game.undoLastMove();
        if (move) {
          this.game.undosUsed++;
          rebuildCellMesh(this.game, move.x, move.y);
          this.game.checkConnections();
          updateGridVisuals(this.game);
          this.audio.playSfx('click');
          this.ui.showToast('Move undone');
        }
      }
    });
  }

  private handleClick(e: MouseEvent, ccw: boolean) {
    if (this.game.state !== 'playing') return;
    const cell = this.raycastToGrid(e);
    if (!cell) return;
    this.rotatePipe(cell[0], cell[1], ccw);
  }

  private handleHover(e: MouseEvent) {
    if (this.game.state !== 'playing') { hideHoverHighlight(); return; }
    const cell = this.raycastToGrid(e);
    if (!cell) { hideHoverHighlight(); return; }
    updateHoverHighlight(this.game, cell[0], cell[1]);
  }

  private raycastToGrid(e: MouseEvent): [number, number] | null {
    // Raycast to find which grid cell was clicked
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast against grid plane
    const ray = new Vector3();
    const origin = new Vector3();
    this.camera.getWorldPosition(origin);
    ray.set(ndcX, ndcY, 0.5).unproject(this.camera).sub(origin).normalize();

    // Grid is at y=1.4 (board height), facing up
    const boardY = 1.4;
    if (ray.y === 0) return null;
    const t = (boardY - origin.y) / ray.y;
    if (t < 0) return null;
    const hitX = origin.x + ray.x * t;
    const hitZ = origin.z + ray.z * t;

    // Convert to grid coordinates
    const halfGrid = (this.game.gridSize * this.game.cellSize) / 2;
    const gx = Math.floor((hitX + halfGrid) / this.game.cellSize);
    const gy = Math.floor((hitZ + halfGrid) / this.game.cellSize);

    if (gx < 0 || gx >= this.game.gridSize || gy < 0 || gy >= this.game.gridSize) return null;
    return [gx, gy];
  }

  rotatePipe(x: number, y: number, ccw: boolean) {
    const cell = this.game.grid[y][x];
    if (cell.isLocked) return;
    if (cell.rotAnim > 0) return; // Still animating

    // Puzzle mode move limit
    if (this.game.moveLimit > 0 && this.game.moves >= this.game.moveLimit) {
      this.ui.showToast('No moves remaining!');
      this.audio.playSfx('fail');
      return;
    }

    const prevType = cell.pipeType;
    cell.pipeType = ccw ? ROTATE_CCW[cell.pipeType] : ROTATE_CW[cell.pipeType];
    this.game.moveHistory.push({ x, y, prevType, newType: cell.pipeType });
    this.game.moves++;

    // Start rotation animation
    cell.rotAnim = 0.15; // 150ms animation
    cell.rotDir = ccw ? -1 : 1;
    this.audio.playSfx('rotate');

    // Rebuild this cell's mesh
    rebuildCellMesh(this.game, x, y);

    // Check connections
    const prevConnected = this.game.connectedPipes;
    this.game.checkConnections();
    updateGridVisuals(this.game);
    buildFlowParticles(this.game, worldRef.scene, THEMES[this.game.stats.selectedTheme]);

    // Combo logic
    if (this.game.connectedPipes > prevConnected) {
      this.game.combo++;
      this.game.comboTimer = 2.5;
      if (this.game.combo > this.game.maxCombo) this.game.maxCombo = this.game.combo;
      if (this.game.combo > 1) {
        this.audio.playSfx('combo');
        this.ui.showToast(`Combo x${this.game.combo}!`);
      }
      this.audio.playSfx('connect');
      // Particle burst on connected pipe
      const pos = getCellWorldPos(this.game, x, y);
      this.particles.burst(pos.x, pos.y, pos.z, THEMES[this.game.stats.selectedTheme].flow, 12);
    }

    // Auto-lock check after each rotation
    checkAutoLock(this.game);

    // Check completion
    if (this.game.isComplete) {
      this.handleLevelComplete();
    }
  }

  private handleLevelComplete() {
    this.audio.playSfx('complete');

    // Start victory chain glow
    this.game.victoryPhase = 1;
    this.game.victoryTimer = 0;

    const s = this.game.stats;
    const score = this.game.connectedPipes * 100 + Math.max(0, Math.floor((120 - this.game.timer) * 10)) + this.game.maxCombo * 50;
    this.game.score = score;

    // Update stats
    s.gamesPlayed++;
    s.levelClears++;
    s.totalScore += score;
    if (score > s.bestScore) s.bestScore = score;
    s.totalMoves += this.game.moves;
    s.totalPipes += this.game.connectedPipes;
    if (this.game.maxCombo > s.bestCombo) s.bestCombo = this.game.maxCombo;
    if (this.game.timer < s.fastestClear || s.fastestClear === 0) s.fastestClear = this.game.timer;
    if (this.game.moves <= this.game.minMoves + 2) { s.perfectLevels++; s.noMistakeLevels++; }
    if (this.game.timer < 60) s.speedChain++;
    else s.speedChain = 0;
    s.modesPlayed.add(this.game.mode);
    s.themesUsed.add(THEMES[s.selectedTheme].name);
    if (this.game.mode === 'daily') s.dailyDone++;
    if (this.game.mode === 'zen') s.zenClears++;
    if (this.game.mode === 'timed') s.timedWins++;
    if (this.game.mode === 'endless') {
      s.endlessClears++;
      // Track endless best level
      if (this.game.level > s.endlessBestLevel) s.endlessBestLevel = this.game.level;
    }
    if (this.game.mode === 'campaign') s.campaignLevel = Math.max(s.campaignLevel, this.game.level);

    // Track powerup-free wins
    if (this.game.hintsUsed === 0 && this.game.undosUsed === 0 && this.game.freezeTimer <= 0) {
      s.noPowerupWins++;
    }

    // XP
    const xpGain = Math.floor(score / 10) + this.game.connectedPipes * 5;
    s.xp += xpGain;
    while (s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level);
      s.level++;
      this.audio.playSfx('levelup');
      this.ui.showToast(`Level Up! ${s.level} - ${getLevelTitle(s.level)}`);
    }

    // Skin unlock check
    let unlockCount = 0;
    for (const skin of PIPE_SKINS) { if (skin.unlockCheck(s)) unlockCount++; }
    s.skinsUnlocked = unlockCount;

    // Achievement check
    for (const ach of ACHIEVEMENTS) {
      if (!this.game.unlockedAchievements.has(ach.id) && ach.check(s)) {
        this.game.unlockedAchievements.add(ach.id);
        this.audio.playSfx('achievement');
        this.ui.showToast(`Achievement: ${ach.name}!`);
      }
    }

    // Leaderboard
    const dateStr = new Date().toLocaleDateString();
    this.game.leaderboard.push({ score, mode: this.game.mode, level: this.game.level, date: dateStr });
    this.game.leaderboard.sort((a, b) => b.score - a.score);
    this.game.leaderboard = this.game.leaderboard.slice(0, 20);

    // Rating
    const starRating = getStarRating(this.game.moves, this.game.minMoves);
    const rating = starRating === 3 ? 'S' : starRating === 2 ? 'A' : starRating === 1 ? 'B' : 'C';

    // Stars tracking
    s.totalStars += starRating;
    if (starRating === 3) s.threeStarLevels++;

    // Win streak
    s.currentStreak++;
    if (s.currentStreak > s.longestStreak) s.longestStreak = s.currentStreak;

    // Mode-specific tracking
    if (this.game.mode === 'puzzle') s.puzzleClears++;
    if (this.game.mode === 'practice') s.practiceClears++;

    // Personal bests per mode
    const modeKey = this.game.mode;
    if (!s.bestModeTimes[modeKey] || this.game.timer < s.bestModeTimes[modeKey]) {
      s.bestModeTimes[modeKey] = this.game.timer;
    }
    if (!s.bestModeScores[modeKey] || score > s.bestModeScores[modeKey]) {
      s.bestModeScores[modeKey] = score;
      this.ui.showToast(`New personal best: ${score}!`);
    }

    this.game.saveStats();

    // Update gameover display
    const goE = (this.ui as any).panelEntities.get('gameover');
    if (goE) {
      const setText = (id: string, txt: string) => {
        const doc = PanelDocument.data.document[goE.index] as UIKitDocument | undefined;
        (doc?.getElementById(id) as UIKit.Text | undefined)?.setProperties({ text: txt });
      };
      setText('result-title', 'LEVEL COMPLETE!');
      setText('result-score', `Score: ${score}`);
      setText('result-moves', `Moves: ${this.game.moves}`);
      setText('result-time', `Time: ${Math.floor(this.game.timer / 60)}:${String(Math.floor(this.game.timer) % 60).padStart(2, '0')}`);
      setText('result-combo', `Best Combo: x${this.game.maxCombo}`);
      setText('result-rating', `Rating: ${rating} ${'*'.repeat(starRating)}${'_'.repeat(3 - starRating)}`);
      setText('result-pipes', `Pipes Connected: ${this.game.connectedPipes}`);
      if (this.game.mode === 'endless') {
        setText('result-title', `LEVEL ${this.game.level} COMPLETE!`);
      }
    }

    // Big particle celebration
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        particlesRef.burst(
          (Math.random() - 0.5) * 0.5,
          1.5 + Math.random() * 0.3,
          -2 + (Math.random() - 0.5) * 0.5,
          THEMES[this.game.stats.selectedTheme].accent, 20
        );
      }, i * 200);
    }

    this.game.state = 'gameover';
    this.audio.playSfx('gameOver');
  }

  update(delta: number) {
    // Countdown
    if (this.game.state === 'countdown') {
      this.countdownTimer -= delta;
      if (this.countdownTimer <= 0) {
        this.game.countdownVal--;
        if (this.game.countdownVal <= 0) {
          this.game.state = 'playing';
          this.audio.playSfx('go');
          this.audio.startMusic();
          // Practice mode: show faint solution overlay
          if (this.game.mode === 'practice') {
            revealSolution(this.game, true, 0.15); // Very faint ghost
          }
        } else {
          this.audio.playSfx('countdown');
          this.countdownTimer = 1;
          const cdE = (this.ui as any).panelEntities.get('countdown');
          if (cdE) {
            const doc = PanelDocument.data.document[cdE.index] as UIKitDocument | undefined;
            (doc?.getElementById('countdown-text') as UIKit.Text | undefined)?.setProperties({
              text: this.game.countdownVal === 0 ? 'FLOW!' : String(this.game.countdownVal),
            });
          }
        }
      }
    }

    // Timer
    if (this.game.state === 'playing') {
      // Freeze timer
      if (this.game.freezeTimer > 0) {
        this.game.freezeTimer -= delta;
      } else {
        this.game.timer += delta;
      }
      this.game.stats.playTime += delta;

      // Combo decay
      if (this.game.comboTimer > 0) {
        this.game.comboTimer -= delta;
        if (this.game.comboTimer <= 0) this.game.combo = 0;
      }

      // Time limit for timed mode
      if (this.game.mode === 'timed' && this.game.timeLimit > 0 && this.game.freezeTimer <= 0) {
        if (this.game.timer >= this.game.timeLimit) {
          this.audio.playSfx('fail');
          this.game.stats.currentStreak = 0; // Reset streak on failure
          this.game.state = 'gameover';
          const goE = (this.ui as any).panelEntities.get('gameover');
          if (goE) {
            const doc = PanelDocument.data.document[goE.index] as UIKitDocument | undefined;
            (doc?.getElementById('result-title') as UIKit.Text | undefined)?.setProperties({ text: 'TIME UP!' });
          }
        }
      }

      // Flow animation on connected pipes
      updateFlowAnimation(this.game, delta);
      updateFlowParticles(this.game, delta);
    }

    // Hint highlight
    updateHintHighlight(delta);

    // XR controller input
    const rightGP = (this.input as any).xr?.gamepads?.right;
    if (rightGP) {
      if (rightGP.getButtonDown(InputComponent.Trigger)) {
        this.handleXRInput(false);
      }
      if (rightGP.getButtonDown(InputComponent.Squeeze)) {
        this.handleXRInput(true);
      }
      if (rightGP.getButtonDown(InputComponent.B_Button)) {
        if (this.game.state === 'playing') this.game.state = 'paused';
        else if (this.game.state === 'paused') this.game.state = 'playing';
      }
    }

    // Particles
    this.particles.update(delta);

    // Environment animation
    if (envRef) {
      for (const deco of envRef.decoGroup.children) {
        deco.rotation.y += (deco.userData as any).rotSpeed * delta;
        deco.position.y = (deco.userData as any).baseY + Math.sin(Date.now() * 0.001 * (deco.userData as any).bobSpeed) * (deco.userData as any).bobAmp;
      }
      for (const p of envRef.ambParticles.children) {
        p.position.x += (p.userData as any).driftX * delta;
        p.position.y += (p.userData as any).driftY * delta;
        (p as Mesh).material && ((p as Mesh).material as MeshBasicMaterial).opacity !== undefined &&
          (((p as Mesh).material as MeshBasicMaterial).opacity = 0.2 + Math.sin(Date.now() * 0.001 * (p.userData as any).pulseSpeed) * 0.15 + 0.15);
        // Wrap around
        if (p.position.x > 5) p.position.x = -5;
        if (p.position.x < -5) p.position.x = 5;
      }
    }

    // Pipe rotation animation
    for (let y = 0; y < this.game.gridSize; y++) {
      for (let x = 0; x < this.game.gridSize; x++) {
        const cell = this.game.grid[y]?.[x];
        if (!cell?.mesh) continue;
        if (cell.rotAnim > 0) {
          cell.rotAnim -= delta;
          if (cell.rotAnim <= 0) {
            cell.rotAnim = 0;
            cell.mesh.rotation.y = 0; // Reset to final position
          } else {
            // Smooth rotation: animate the remaining angle
            const progress = 1 - (cell.rotAnim / 0.15);
            const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic
            cell.mesh.rotation.y = cell.rotDir * (Math.PI / 2) * (1 - eased);
          }
        }
      }
    }

    // Entrance animation
    if (this.game.entranceActive) {
      this.game.entranceTimer += delta;
      let allDone = true;
      for (let y = 0; y < this.game.gridSize; y++) {
        for (let x = 0; x < this.game.gridSize; x++) {
          const cell = this.game.grid[y]?.[x];
          if (!cell?.mesh) continue;
          if (cell.entranceProgress >= 1) continue;
          const elapsed = this.game.entranceTimer - cell.entranceDelay;
          if (elapsed <= 0) {
            cell.mesh.scale.setScalar(0);
            cell.mesh.visible = false;
            allDone = false;
            continue;
          }
          cell.mesh.visible = true;
          cell.entranceProgress = Math.min(1, elapsed / 0.25);
          const t = cell.entranceProgress;
          const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          const scale = eased * (1 + (1 - t) * 0.15); // slight overshoot
          cell.mesh.scale.setScalar(Math.min(scale, 1.05));
          if (cell.entranceProgress < 1) allDone = false;
        }
      }
      if (allDone) {
        this.game.entranceActive = false;
        // Ensure all scales are exactly 1
        for (let y = 0; y < this.game.gridSize; y++) {
          for (let x = 0; x < this.game.gridSize; x++) {
            const cell = this.game.grid[y]?.[x];
            if (cell?.mesh) cell.mesh.scale.setScalar(1);
          }
        }
      }
    }

    // Victory path glow sequence
    if (this.game.victoryPhase > 0 && this.game.connectedPath.length > 0) {
      this.game.victoryTimer += delta;
      const glowSpeed = 0.04; // seconds per cell
      const glowIdx = Math.floor(this.game.victoryTimer / glowSpeed);
      for (let i = 0; i < this.game.connectedPath.length; i++) {
        const [cx, cy] = this.game.connectedPath[i];
        const cell = this.game.grid[cy]?.[cx];
        if (!cell?.mesh) continue;
        if (i <= glowIdx) {
          // Chain glow: pulsing bright
          const fadeFactor = Math.max(0, 1 - (glowIdx - i) * 0.05);
          const pulse = 0.8 + Math.sin(Date.now() * 0.01 + i * 0.5) * 0.2;
          for (const child of cell.mesh.children) {
            if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
              (child.material as MeshStandardMaterial).emissiveIntensity = pulse * fadeFactor;
            }
          }
        }
      }
      // End victory sequence after all cells glowed
      if (glowIdx > this.game.connectedPath.length + 10) {
        this.game.victoryPhase = 0;
        this.game.victoryTimer = 0;
      }
    }

    // Puzzle mode: check move limit expiry
    if (this.game.state === 'playing' && this.game.moveLimit > 0 && this.game.moves >= this.game.moveLimit && !this.game.isComplete) {
      // Give 1 second grace after last move, then check if completed
      // Actually checked inline when move happens, but handle timeout
    }

    // Grid glow animation
    if (this.game.state === 'playing' || this.game.state === 'gameover') {
      for (let y = 0; y < this.game.gridSize; y++) {
        for (let x = 0; x < this.game.gridSize; x++) {
          const cell = this.game.grid[y]?.[x];
          if (!cell?.mesh) continue;
          // Pulse glow on connected pipes
          const glowChild = cell.mesh.children.find(c => c instanceof Mesh && (c as Mesh).material instanceof MeshBasicMaterial && ((c as Mesh).material as MeshBasicMaterial).blending === AdditiveBlending && c.geometry instanceof SphereGeometry);
          if (glowChild) {
            const mat = (glowChild as Mesh).material as MeshBasicMaterial;
            mat.opacity = cell.isConnected
              ? 0.2 + Math.sin(Date.now() * 0.003) * 0.1
              : 0.08;
          }
        }
      }
    }
  }

  private handleXRInput(ccw: boolean) {
    if (this.game.state !== 'playing') return;
    // XR: use ray from right controller to find grid cell
    const rightRay = (worldRef as any).playerSpaceEntities?.raySpaces?.right?.object3D;
    if (!rightRay) return;
    const origin = new Vector3();
    const direction = new Vector3(0, 0, -1);
    rightRay.getWorldPosition(origin);
    rightRay.getWorldDirection(direction);
    direction.negate();

    const boardY = 1.4;
    if (direction.y === 0) return;
    const t = (boardY - origin.y) / direction.y;
    if (t < 0) return;
    const hitX = origin.x + direction.x * t;
    const hitZ = origin.z + direction.z * t;

    const halfGrid = (this.game.gridSize * this.game.cellSize) / 2;
    const gx = Math.floor((hitX + halfGrid) / this.game.cellSize);
    const gy = Math.floor((hitZ + halfGrid) / this.game.cellSize);

    if (gx < 0 || gx >= this.game.gridSize || gy < 0 || gy >= this.game.gridSize) return;
    this.rotatePipe(gx, gy, ccw);
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getCellWorldPos(game: GameStateManager, x: number, y: number): Vector3 {
  const halfGrid = (game.gridSize * game.cellSize) / 2;
  return new Vector3(
    x * game.cellSize - halfGrid + game.cellSize / 2,
    1.4,
    y * game.cellSize - halfGrid + game.cellSize / 2 - 2,
  );
}

function rebuildCellMesh(game: GameStateManager, x: number, y: number) {
  const cell = game.grid[y][x];
  if (cell.mesh) {
    game.gridGroup.remove(cell.mesh);
  }
  const theme = THEMES[game.stats.selectedTheme];
  const skin = PIPE_SKINS[game.stats.selectedSkin];
  const mesh = buildPipeMesh(cell.pipeType, skin, theme, cell.isSource, cell.isDrain, cell.isLocked, gameRef?.stats?.colorblindMode ?? false);
  const pos = getCellWorldPos(game, x, y);
  mesh.position.copy(pos);
  game.gridGroup.add(mesh);
  cell.mesh = mesh;
}

function buildGrid(game: GameStateManager, scene: any) {
  // Remove old grid
  clearGrid(game);
  game.gridGroup = new Group();
  scene.add(game.gridGroup);

  const theme = THEMES[game.stats.selectedTheme];

  // Build cell base tiles
  const tileGeo = new PlaneGeometry(game.cellSize * 0.92, game.cellSize * 0.92);
  for (let y = 0; y < game.gridSize; y++) {
    for (let x = 0; x < game.gridSize; x++) {
      // Base tile
      const tileMat = new MeshStandardMaterial({
        color: theme.wall, emissive: theme.grid, emissiveIntensity: 0.05,
        metalness: 0.5, roughness: 0.7, transparent: true, opacity: 0.4, side: DoubleSide,
      });
      const tile = new Mesh(tileGeo, tileMat);
      const pos = getCellWorldPos(game, x, y);
      tile.position.copy(pos);
      tile.position.y -= 0.001;
      tile.rotation.x = -Math.PI / 2;
      game.gridGroup.add(tile);

      // Pipe mesh
      rebuildCellMesh(game, x, y);
    }
  }

  // Grid border
  const halfGrid = (game.gridSize * game.cellSize) / 2;
  const borderGeo = new BoxGeometry(game.gridSize * game.cellSize + 0.02, 0.005, 0.005);
  const borderMat = new MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.5 });
  const borders = [
    [0, 1.399, -halfGrid - 2 - 0.003], [0, 1.399, halfGrid - 2 + 0.003],
  ];
  for (const [bx, by, bz] of borders) {
    const b = new Mesh(borderGeo, borderMat);
    b.position.set(bx, by, bz);
    game.gridGroup.add(b);
  }
  const sideBorderGeo = new BoxGeometry(0.005, 0.005, game.gridSize * game.cellSize + 0.02);
  for (const side of [-1, 1]) {
    const b = new Mesh(sideBorderGeo, borderMat);
    b.position.set(side * (halfGrid + 0.003), 1.399, -2);
    game.gridGroup.add(b);
  }
}

function clearGrid(game: GameStateManager) {
  if (game.gridGroup.parent) {
    game.gridGroup.parent.remove(game.gridGroup);
  }
  // Clear flow meshes
  for (const fm of flowMeshes) {
    if (fm.parent) fm.parent.remove(fm);
  }
  flowMeshes = [];
  // Clear flow particles
  for (const fp of game.flowParticles) {
    if (fp.mesh.parent) fp.mesh.parent.remove(fp.mesh);
  }
  game.flowParticles = [];
  game.connectedPath = [];
  // Clear hint highlight
  if (hintHighlightMesh?.parent) hintHighlightMesh.parent.remove(hintHighlightMesh);
  hintHighlightMesh = null;
  hintTimer = 0;
  // Clear hover highlight
  if (hoverHighlightMesh?.parent) hoverHighlightMesh.parent.remove(hoverHighlightMesh);
  hoverHighlightMesh = null;
  // Clear reveal overlays
  for (const m of revealOverlays) {
    if (m.parent) m.parent.remove(m);
  }
  revealOverlays = [];
}

function updateGridVisuals(game: GameStateManager) {
  const theme = THEMES[game.stats.selectedTheme];
  for (let y = 0; y < game.gridSize; y++) {
    for (let x = 0; x < game.gridSize; x++) {
      const cell = game.grid[y][x];
      if (!cell.mesh) continue;
      // Update pipe color based on connection state
      for (const child of cell.mesh.children) {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          const mat = child.material as MeshStandardMaterial;
          if (cell.isSource) continue;
          if (cell.isDrain) continue;
          if (cell.isConnected) {
            mat.emissiveIntensity = 0.8;
            mat.emissive.setHex(theme.flow);
          } else {
            mat.emissiveIntensity = 0.3;
            mat.emissive.setHex(PIPE_SKINS[game.stats.selectedSkin].emissive);
          }
        }
      }
    }
  }
}

function updateFlowAnimation(game: GameStateManager, _delta: number) {
  // Animate flow particles along connected path
  game.flowAnimProgress += _delta * 0.5;
  if (game.flowAnimProgress > 1) game.flowAnimProgress -= 1;
}

// Hint highlight: pulse a cell's border to draw attention
let hintHighlightMesh: Mesh | null = null;
let hintTimer = 0;

function highlightHintCell(game: GameStateManager, x: number, y: number) {
  // Remove previous hint
  if (hintHighlightMesh?.parent) hintHighlightMesh.parent.remove(hintHighlightMesh);

  const pos = getCellWorldPos(game, x, y);
  const geo = new PlaneGeometry(game.cellSize * 1.05, game.cellSize * 1.05);
  const mat = new MeshBasicMaterial({
    color: 0xffff00, transparent: true, opacity: 0.4, blending: AdditiveBlending, side: DoubleSide,
  });
  hintHighlightMesh = new Mesh(geo, mat);
  hintHighlightMesh.position.copy(pos);
  hintHighlightMesh.position.y -= 0.0005;
  hintHighlightMesh.rotation.x = -Math.PI / 2;
  game.gridGroup.add(hintHighlightMesh);
  hintTimer = 3; // Show for 3 seconds
}

function updateHintHighlight(delta: number) {
  if (hintHighlightMesh && hintTimer > 0) {
    hintTimer -= delta;
    // Pulse effect
    const mat = hintHighlightMesh.material as MeshBasicMaterial;
    mat.opacity = 0.2 + Math.sin(Date.now() * 0.008) * 0.2;
    if (hintTimer <= 0) {
      if (hintHighlightMesh.parent) hintHighlightMesh.parent.remove(hintHighlightMesh);
      hintHighlightMesh = null;
    }
  }
}

// Build flow particles that travel along connected pipes
function buildFlowParticles(game: GameStateManager, scene: any, theme: Theme) {
  // Clean up old flow particles
  for (const fp of game.flowParticles) {
    if (fp.mesh.parent) fp.mesh.parent.remove(fp.mesh);
  }
  game.flowParticles = [];

  // Build connected path from source
  if (!game.isComplete && game.connectedPipes < 3) return;

  const visited = new Set<string>();
  const queue: [number, number][] = [game.sourcePos];
  visited.add(`${game.sourcePos[0]},${game.sourcePos[1]}`);
  const path: [number, number][] = [game.sourcePos];

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    const cell = game.grid[cy][cx];
    const connections = PIPE_CONNECTIONS[cell.pipeType];
    for (const dir of connections) {
      const [dx, dy] = DIR_OFFSET[dir];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= game.gridSize || ny < 0 || ny >= game.gridSize) continue;
      if (visited.has(`${nx},${ny}`)) continue;
      const neighbor = game.grid[ny][nx];
      if (PIPE_CONNECTIONS[neighbor.pipeType].includes(OPPOSITE[dir])) {
        visited.add(`${nx},${ny}`);
        queue.push([nx, ny]);
        path.push([nx, ny]);
      }
    }
  }

  game.connectedPath = path;

  // Create flow particles
  const particleCount = Math.min(path.length * 2, 20);
  const geo = new SphereGeometry(0.006, 4, 4);
  for (let i = 0; i < particleCount; i++) {
    const mat = new MeshBasicMaterial({
      color: theme.flow, transparent: true, opacity: 0.7, blending: AdditiveBlending,
    });
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    game.flowParticles.push({
      mesh,
      pathIdx: 0,
      t: i / particleCount,
      speed: 0.3 + Math.random() * 0.2,
    });
  }
}

function updateFlowParticles(game: GameStateManager, delta: number) {
  if (game.connectedPath.length < 2) return;
  const pathLen = game.connectedPath.length;

  for (const fp of game.flowParticles) {
    fp.t += fp.speed * delta;
    if (fp.t >= pathLen) fp.t -= pathLen;
    if (fp.t < 0) fp.t += pathLen;

    const idx = Math.floor(fp.t);
    const frac = fp.t - idx;
    const [cx, cy] = game.connectedPath[idx % pathLen];
    const [nx, ny] = game.connectedPath[(idx + 1) % pathLen];

    const p1 = getCellWorldPos(game, cx, cy);
    const p2 = getCellWorldPos(game, nx, ny);

    fp.mesh.position.set(
      p1.x + (p2.x - p1.x) * frac,
      p1.y + 0.015 + Math.sin(fp.t * 3) * 0.005,
      p1.z + (p2.z - p1.z) * frac,
    );
    fp.mesh.visible = true;
    (fp.mesh.material as MeshBasicMaterial).opacity = 0.5 + Math.sin(fp.t * 2 + Date.now() * 0.003) * 0.3;
  }
}

// Reveal solution: show ghost pipes in solved position
let revealOverlays: Mesh[] = [];

function revealSolution(game: GameStateManager, show: boolean, opacity = 0.35) {
  // Clean up any existing overlays
  for (const m of revealOverlays) {
    if (m.parent) m.parent.remove(m);
  }
  revealOverlays = [];

  if (!show) return;

  const theme = THEMES[game.stats.selectedTheme];
  for (let y = 0; y < game.gridSize; y++) {
    for (let x = 0; x < game.gridSize; x++) {
      const cell = game.grid[y][x];
      if (cell.isLocked || cell.pipeType === game.solvedGrid[y][x]) continue;

      // Show a ghost overlay of the solved pipe type
      const connections = PIPE_CONNECTIONS[game.solvedGrid[y][x]];
      const pos = getCellWorldPos(game, x, y);

      // Draw translucent solution pipes
      const g = new Group();
      const pipeRadius = 0.012;
      const halfCell = 0.05;
      const ghostMat = new MeshBasicMaterial({
        color: theme.flow, transparent: true, opacity, blending: AdditiveBlending,
      });

      for (const dir of connections) {
        const segGeo = new CylinderGeometry(pipeRadius, pipeRadius, halfCell, 6);
        const seg = new Mesh(segGeo, ghostMat);
        switch (dir) {
          case 'up': seg.position.set(0, 0.02, -halfCell / 2); seg.rotation.x = Math.PI / 2; break;
          case 'down': seg.position.set(0, 0.02, halfCell / 2); seg.rotation.x = Math.PI / 2; break;
          case 'left': seg.position.set(-halfCell / 2, 0.02, 0); seg.rotation.z = Math.PI / 2; break;
          case 'right': seg.position.set(halfCell / 2, 0.02, 0); seg.rotation.z = Math.PI / 2; break;
        }
        g.add(seg);
      }
      const hubGeo = new SphereGeometry(pipeRadius * 1.5, 6, 6);
      const hub = new Mesh(hubGeo, ghostMat);
      hub.position.y = 0.02;
      g.add(hub);

      g.position.copy(pos);
      game.gridGroup.add(g);
      revealOverlays.push(g as any);
    }
  }
}

// Hover highlight mesh
let hoverHighlightMesh: Mesh | null = null;

function updateHoverHighlight(game: GameStateManager, x: number, y: number) {
  const theme = THEMES[game.stats.selectedTheme];
  if (!hoverHighlightMesh) {
    const geo = new PlaneGeometry(game.cellSize * 0.95, game.cellSize * 0.95);
    const mat = new MeshBasicMaterial({
      color: theme.accent, transparent: true, opacity: 0.12, blending: AdditiveBlending, side: DoubleSide,
    });
    hoverHighlightMesh = new Mesh(geo, mat);
    hoverHighlightMesh.rotation.x = -Math.PI / 2;
    game.gridGroup.add(hoverHighlightMesh);
  }
  const pos = getCellWorldPos(game, x, y);
  hoverHighlightMesh.position.copy(pos);
  hoverHighlightMesh.position.y += 0.001;
  hoverHighlightMesh.visible = true;
  (hoverHighlightMesh.material as MeshBasicMaterial).color.setHex(theme.accent);
}

function hideHoverHighlight() {
  if (hoverHighlightMesh) hoverHighlightMesh.visible = false;
}

// Auto-lock: check all pipes against solved state and lock correct ones
function checkAutoLock(game: GameStateManager) {
  if (!game.stats.autoLockEnabled) return;
  for (let y = 0; y < game.gridSize; y++) {
    for (let x = 0; x < game.gridSize; x++) {
      const cell = game.grid[y][x];
      if (cell.isLocked) continue;
      if (cell.pipeType === game.solvedGrid[y][x]) {
        cell.isLocked = true;
        rebuildCellMesh(game, x, y);
      }
    }
  }
}

function startGame(game: GameStateManager, audio: AudioManager) {
  let size = game.gridSize;

  // Campaign zone-based sizing
  if (game.mode === 'campaign') {
    const zoneIdx = Math.min(Math.floor((game.level - 1) / 6), 5);
    const zone = CAMPAIGN_ZONES[zoneIdx];
    const levelInZone = (game.level - 1) % 6;
    size = zone.gridMin + Math.floor(levelInZone * (zone.gridMax - zone.gridMin) / Math.max(1, zone.levels - 1));
    game.gridSize = size;
  }

  // Endless mode: progressive difficulty - grid grows every 3 levels
  if (game.mode === 'endless') {
    const baseSizes: Record<Difficulty, number> = { easy: 4, medium: 5, hard: 7 };
    const base = baseSizes[game.difficulty] || 5;
    size = Math.min(12, base + Math.floor((game.level - 1) / 3));
    game.gridSize = size;
  }

  // Speed mode: always starts small but gets harder
  if (game.mode === 'speed') {
    size = Math.min(8, 4 + Math.floor((game.level - 1) / 2));
    game.gridSize = size;
  }

  const rng = game.mode === 'daily' ? mulberry32(dateSeed()) : mulberry32(Date.now());

  game.score = 0;
  game.moves = 0;
  game.timer = 0;
  game.combo = 0;
  game.maxCombo = 0;
  game.comboTimer = 0;
  game.connectedPipes = 0;
  game.isComplete = false;
  game.flowAnimProgress = 0;
  game.countdownVal = 3;
  game.victoryPhase = 0;
  game.victoryTimer = 0;

  // Time limits based on mode
  game.timeLimit = game.mode === 'timed' ? (game.difficulty === 'easy' ? 120 : game.difficulty === 'medium' ? 90 : 60) : 0;
  if (game.mode === 'speed') game.timeLimit = 30;

  // Puzzle mode: move limit = min moves + small buffer
  game.moveLimit = 0;
  if (game.mode === 'puzzle') {
    // Set after grid generation since minMoves calculated there
  }

  game.generateGrid(size, rng);
  game.checkConnections();

  // Puzzle mode: set move limit after grid generation
  if (game.mode === 'puzzle') {
    game.moveLimit = game.minMoves + Math.max(3, Math.floor(game.minMoves * 0.5));
  }

  // Practice mode: show solution hints (via reveal overlays that stay)
  if (game.mode === 'practice') {
    // Solution hints shown after grid builds (triggered after countdown)
  }

  buildGrid(game, worldRef.scene);
  updateGridVisuals(game);
  buildFlowParticles(game, worldRef.scene, THEMES[game.stats.selectedTheme]);

  // Start entrance animation
  game.entranceActive = true;
  game.entranceTimer = 0;

  audio.playSfx('gameStart');
  game.state = 'countdown';
  game.countdownVal = 3;

  // Update countdown panel
  setTimeout(() => {
    audio.playSfx('countdown');
  }, 100);
}

// ============================================================
// MAIN ENTRY
// ============================================================

async function main() {
  const container = document.getElementById('app') as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: 'once' },
    input: { canvasPointerEvents: true },
    render: {
      near: 0.01,
      far: 200,
      camera: { position: [0, 1.6, 0], lookAt: [0, 1.4, -2] },
    },
    features: {
      locomotion: { browserControls: true } as any,
      physics: false,
      grabbing: false,
    },
  } as any);

  worldRef = world;

  const game = new GameStateManager();
  gameRef = game;

  const audio = new AudioManager();
  audioRef = audio;

  const theme = THEMES[game.stats.selectedTheme];
  envRef = buildEnvironment(world.scene, theme);

  const particles = new ParticlePool(world.scene, 150);
  particlesRef = particles;

  // Create panel entities
  const panelConfigs: { config: string; pos: [number, number, number]; rot?: [number, number, number]; follower?: boolean; screenSpace?: boolean; scale?: number }[] = [
    { config: './ui/title.json', pos: [0, 1.6, -2.5] },
    { config: './ui/modeselect.json', pos: [0, 1.6, -2.5] },
    { config: './ui/difficulty.json', pos: [0, 1.6, -2.5] },
    { config: './ui/hud.json', pos: [0, 0.12, -0.5], follower: true },
    { config: './ui/pause.json', pos: [0, 1.6, -2.5] },
    { config: './ui/gameover.json', pos: [0, 1.6, -2.5] },
    { config: './ui/leaderboard.json', pos: [0, 1.6, -2.5] },
    { config: './ui/achvlist.json', pos: [0, 1.6, -2.5] },
    { config: './ui/stats.json', pos: [0, 1.6, -2.5] },
    { config: './ui/settings.json', pos: [0, 1.6, -2.5] },
    { config: './ui/help.json', pos: [0, 1.6, -2.5] },
    { config: './ui/toast.json', pos: [0, 0.08, -0.5], follower: true },
    { config: './ui/countdown.json', pos: [0, 0, -0.6], follower: true },
    { config: './ui/skins.json', pos: [0, 1.6, -2.5] },
    { config: './ui/flowbar.json', pos: [0, -0.1, -0.5], follower: true },
    { config: './ui/toolbar.json', pos: [0, -0.16, -0.5], follower: true },
    { config: './ui/campaign.json', pos: [0, 1.6, -2.5] },
  ];

  for (const pc of panelConfigs) {
    const entity = world.createTransformEntity();
    entity.object3D!.position.set(...pc.pos);
    entity.addComponent(PanelUI, { config: pc.config });
    if (pc.follower) {
      entity.addComponent(Follower, { target: world.player.head, behavior: FollowBehavior.PivotY });
      const ov = entity.getVectorView(Follower, 'offsetPosition');
      ov[0] = pc.pos[0]; ov[1] = pc.pos[1]; ov[2] = pc.pos[2];
    }
  }

  // Register systems
  world.registerSystem(GameUISystem);
  world.registerSystem(GameLogicSystem);

  const uiSystem = world.getSystem(GameUISystem)!;
  uiSystem.setRefs({ game, audio });
  uiRef = uiSystem;

  const logicSystem = world.getSystem(GameLogicSystem)!;
  logicSystem.setRefs({ game, audio, ui: uiSystem, particles });
}

main().catch(console.error);
