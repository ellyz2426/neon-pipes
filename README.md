# Neon Connect VR

A feature-rich Connect Four game built with [IWSDK](https://iwsdk.dev) (Immersive Web SDK) — playable in both browser and VR.

**[Play Now](https://ellyz2426.github.io/neon-connect/)**

## Features

### Gameplay
- **8 Game Modes**: Classic, Timed, Blitz, Pop Out, Five-in-a-Row, Daily Challenge, Practice, Versus
- **3 AI Difficulties**: Easy, Medium, Hard (minimax with alpha-beta pruning)
- **Combo System**: Chain threats for bonus XP
- **Replay System**: Review completed games move-by-move
- **Practice Mode**: Undo moves and get AI hints
- **Daily Challenges**: Seeded puzzles — same for everyone each day

### Progression
- **60 Achievements** across multiple categories
- **XP & Leveling System** with 15 level titles
- **10 Disc Skins** unlocked via gameplay milestones
- **5 Visual Themes**: Neon Holodeck, Crimson Arena, Emerald Void, Solar Forge, Void Chamber
- **Leaderboard** tracking best scores per mode
- **Detailed Statistics** per mode and overall

### Visual & Audio
- **Procedural Background Music** — ambient drones per theme
- **Holographic Environment** — floating rings, pulsing grid lines, accent pillars
- **Particle Effects** — drop splashes, win celebrations, ambient floating particles
- **Column Arrows & Ghost Discs** — visual drop preview
- **Board Shake & Entry Animation** — elastic board appearance, impact feedback
- **Win Line Renderer** — animated TubeGeometry connecting winning discs
- **Timer Warning Effects** — screen flash for timed/blitz modes
- **AI Thinking Indicator** — animated dots during AI turns
- **Board Reflection** — shimmer effect below the board
- **15 PanelUI Spatial Panels** — all UI is spatial, no HTML overlays

### Controls
| Input | Action |
|-------|--------|
| Mouse hover / VR laser | Highlight column |
| Click / Trigger | Drop disc |
| 1-7 keys | Quick drop by column |
| U | Undo (Practice) |
| H | Hint (Practice) |
| P / ESC | Pause |
| R | Rematch (game over) |
| B (VR) | Pause |

### Technical
- Built with IWSDK 0.4.x on Three.js + ECS
- Single-file architecture (~2500 LOC)
- All UI via PanelUI/uikitml — zero HTML overlays
- XR controller support via RayInteractable
- localStorage persistence for all progress
- Procedural audio (no external audio files)
- Deployed via GitHub Pages

## Development

```bash
npm install
npm run dev        # Start dev server
npm run build      # Production build
```

## License

MIT
