# VEX V5 LemLib Path Planner – Override

Interactive path planner for **VEX V5 Robotics Competition Override (2026-27)** that generates **LemLib** chassis code, featuring a comprehensive V5 development environment.

## Features

- **Visual Path Planning:** Drag start robot and waypoints with full motion set (`moveToPoint`/`Pose`, `turnToHeading`, `swing`, `Custom Code`).
- **Flowchart Editor:** Manage sequential actions with reorder, delete, and inline edit capabilities.
- **2D Kinematic Simulator:** Realistic LemLib behavior simulation (acceleration, deceleration, slip, match timing).
- **VRC Override Engine (Beta):** Simulate game pieces (pins, goals) and perimeter wall toggles.
- **PROS C++ IDE:** Multi-file code studio with cross-file variable indexing, compiler diagnostics, and safe sync between visual blocks and `src/autons.cpp`.
- **V5 Brain Flasher:** Direct USB Web Serial connection to flash routines to V5 Brain slots 1-8.
- **Productivity Tools:** Auto-save, `.vpath` import/export, and interactive onboarding tutorial for new users.

## Coordinate system

- Origin (0, 0) = field center  
- +X = right, +Y = up  
- Heading 0° = +Y, increases **clockwise**  
- Units: inches  

## License

MIT
