# VEX V5 LemLib Path Planner – Push Back

Interactive web tool for planning autonomous paths for **VEX V5 Robotics Competition Push Back (2025-26)** using **LemLib** movement functions.

## Features

- Top-down view of the official Push Back field (your provided image)
- Starting pose must touch a field wall (per normal VEX rules) – presets for common alliance starts
- Click the field or type coordinates to set targets
- Supported LemLib motions:
  - `chassis.moveToPoint`
  - `chassis.moveToPose`
  - `chassis.turnToPoint`
  - `chassis.turnToHeading`
  - `chassis.swingToPoint`
  - `chassis.swingToHeading`
- Configurable timeout, forwards/backwards, max/min speed, locked side for swings
- Clear end-direction arrow and end-pose robot overlay
- Path simulation with adjustable playback speed
- One-click generation of ready-to-paste LemLib C++ code
- Coordinate system: inches, origin at field center, heading 0° = +Y (up), increases clockwise

## Live Demo

Once GitHub Pages is enabled the site will be available at:

`https://yl-loaf.github.io/vex-path-planner/`

## Local Use

Just open `index.html` in a modern browser (or serve the folder with any static server).

## Coordinate Notes

- Field is 12 ft × 12 ft (144 in). Playable area is slightly less due to walls.
- Origin (0, 0) = geometric center of the field.
- +X = right, +Y = up (toward the top of the provided image).
- Heading follows common LemLib / VEX GPS convention used in many path tools: 0° points up (+Y), positive rotation is clockwise.

## License

MIT – free to use and modify for your team.
