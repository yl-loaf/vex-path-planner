# VEX V5 LemLib Path Planner – Push Back

Interactive path planner for **VEX V5 Robotics Competition Push Back (2025-26)** that generates **LemLib** chassis code.

## Features

- **Drag** the start robot (snaps near walls) and **drag** waypoints on the field
- Click empty field space to place a new action of the selected type
- Full motion set:
  - `moveToPoint` / `moveToPose`
  - `turnToPoint` / `turnToHeading`
  - `swingToPoint` / `swingToHeading`
  - **Custom Code** blocks
- **Flowchart-style** editable action list (reorder, delete, inline edit)
- Per-action: timeout, forwards, max/min speed, earlyExitRange, locked side, **async**
- **Code-only offsets** (ΔX / ΔY / Δθ) – applied in generated code, hidden from simulation
- Simulation approximating LemLib behaviour (facing target on moveToPoint, pose heading on moveToPose, in-place turns)
- **Export / Import** `.vpath` files
- **Auto-save** to browser `localStorage` so you don’t lose work
- Clear end-direction arrow + live robot during playback

## Live site

After enabling GitHub Pages (Settings → Pages → Deploy from `main` / root):

`https://yl-loaf.github.io/vex-path-planner/`

Place `field.jpg` in the repo root so the real field image loads.

## Coordinate system

- Origin (0, 0) = field center  
- +X = right, +Y = up  
- Heading 0° = +Y, increases **clockwise**  
- Units: inches  

## License

MIT
