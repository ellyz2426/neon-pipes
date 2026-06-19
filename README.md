# Neon Pipes VR 🔧

A holodeck-style VR pipe flow puzzle built with [IWSDK](https://iwsdk.dev). Rotate pipe segments to connect the source to the drain and guide the flow through the grid.

**[▶ Play Now](https://ellyz2426.github.io/neon-pipes/)**

## Gameplay

- Rotate pipes on a grid to create a continuous path from source (green) to drain (red)
- Every level is procedurally generated with a guaranteed solvable path
- Click/trigger to rotate clockwise, grip to rotate counter-clockwise
- Build combos by rotating pipes quickly — combo multiplier boosts your score
- 11 pipe types: straight, elbow, T-junction, and cross pieces

## Features

- **8 Game Modes**: Campaign (36 levels across 6 zones), Time Attack, Endless, Zen, Daily Challenge, Speed Run, Puzzle, and Practice
- **3 Difficulty Levels**: Easy (5×5), Medium (7×7), Hard (9×9)
- **40 Achievements** with unlock tracking
- **8 Pipe Skins** unlocked through gameplay milestones
- **5 Color Themes**: Neon Holodeck, Crimson Grid, Toxic Neon, Ultra Violet, Solar Blaze
- **XP & Level System** with 50 progression levels
- **Daily Challenges** with seeded PRNG for consistent puzzles
- **Leaderboards** and career statistics
- **Procedural Audio**: connection SFX, rotation clicks, ambient drone, combo sounds

## Controls

### VR (Quest / WebXR)
| Input | Action |
|-------|--------|
| Trigger | Rotate pipe clockwise |
| Grip | Rotate pipe counter-clockwise |
| B / Y | Pause |
| Thumbstick | Navigate menus |

### Browser
| Input | Action |
|-------|--------|
| Left Click | Rotate pipe clockwise |
| Right Click | Rotate pipe counter-clockwise |
| Mouse | Look around |
| WASD | Move |

## Tech

- Built with [IWSDK](https://iwsdk.dev) 0.4.x (Immersive Web SDK)
- 15 PanelUI spatial panels — zero HTML DOM UI
- ECS architecture with dedicated game logic and UI systems
- Dual runtime: full VR + browser-first with mouselook
- BFS-based flow validation
- Procedural grid generation with random walk path algorithm
- ~1,650 lines TypeScript + 216 lines uikitml

## Development

```bash
npm install
npx iwsdk dev
```

## License

MIT
