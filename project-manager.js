// project-manager.js - PROS LemLib Multi-File Project Manager, Symbol Indexer, and Compiler Engine
(function(global) {
  "use strict";

  const STORAGE_KEY_PROJECT = "lemlib_active_project";
  const STORAGE_KEY_PROJECT_DIRTY = "lemlib_project_dirty";

  const IDB_DB_NAME = "LemLibProjectDB";
  const IDB_STORE_NAME = "projects";
  const IDB_PROJECT_KEY = "active_project";

  function getApiUrl(path) {
    if (typeof window !== "undefined" && typeof window.getApiUrl === "function") {
      return window.getApiUrl(path);
    }
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".run.app")) {
      return path;
    }
    return null;
  }

  function openProjectDB() {
    return new Promise((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      try {
        const req = indexedDB.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.createObjectStore(IDB_STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  function idbPut(key, val) {
    return openProjectDB().then((db) => {
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE_NAME, "readwrite");
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
          const store = tx.objectStore(IDB_STORE_NAME);
          store.put(val, key);
        } catch (e) {
          resolve(false);
        }
      });
    });
  }

  function idbGet(key) {
    return openProjectDB().then((db) => {
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE_NAME, "readonly");
          const store = tx.objectStore(IDB_STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  function idbDelete(key) {
    return openProjectDB().then((db) => {
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE_NAME, "readwrite");
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          const store = tx.objectStore(IDB_STORE_NAME);
          store.delete(key);
        } catch (e) {
          resolve(false);
        }
      });
    });
  }

  const DEFAULT_TEMPLATES = {
    "src/autons.cpp": `// =================================================================
// autons.cpp - Autonomous Routines for VEX V5 LemLib
// =================================================================
#include "main.h"
#include "robot-config.h"
#include "subsystems.hpp"

// -----------------------------------------------------------------
// Routine 1: Red Mogo Rush & Preload
// -----------------------------------------------------------------
void red_rush_auton() {
    // 1. Configure start pose at field tile corner (-60, -60, 0 deg)
    chassis.setPose(-60, -60, 0);

    // 2. Spin intake to score preload
    intake.move(127);

    // 3. Drive towards mobile goal
    chassis.moveToPoint(-24, -24, 2000, {.forwards = true, .maxSpeed = 115, .earlyExitRange = 2});

    // 4. Trigger clamp at 12 inches along path
    chassis.waitUntil(12);
    clamp.set_value(true);

    // 5. Back up to scoring position
    chassis.moveToPose(0, 48, 90, 2500, {.lead = 0.5, .forwards = false});

    // 6. Turn towards corner ring stack
    chassis.turnToHeading(180, 1500, {.maxSpeed = 100});
}

// -----------------------------------------------------------------
// Routine 2: Blue Solo AWP
// -----------------------------------------------------------------
void blue_solo_awp() {
    chassis.setPose(60, -60, 0);
    intake.move(127);
    chassis.moveToPoint(24, -24, 2200, {.forwards = true, .maxSpeed = 110});
    chassis.waitUntilDone();
    clamp.set_value(true);
    chassis.turnToHeading(270, 1400);
}

// -----------------------------------------------------------------
// Routine 3: Autonomous Skills Routine (60s)
// -----------------------------------------------------------------
void skills_auton() {
    chassis.setPose(-60, 0, 90);
    intake.move(127);
    chassis.moveToPoint(-48, 0, 1800, {.forwards = true});
    clamp.set_value(true);
    chassis.turnToHeading(0, 1200);
}
`,

    "include/robot-config.h": `// =================================================================
// robot-config.h - Robot Hardware & LemLib Drivetrain Declarations
// =================================================================
#pragma once
#include "main.h"
#include "lemlib/api.hpp"

// Smart Port Motor Declarations
extern pros::Motor left_front;
extern pros::Motor left_middle;
extern pros::Motor left_back;
extern pros::Motor right_front;
extern pros::Motor right_middle;
extern pros::Motor right_back;

// Motor Groups
extern pros::MotorGroup left_motors;
extern pros::MotorGroup right_motors;

// Subsystem Actuators
extern pros::Motor intake;
extern pros::Motor lift;
extern pros::adi::DigitalOut clamp;
extern pros::adi::DigitalOut doinker;
extern pros::adi::DigitalOut intake_lift;

// Sensors & IMU
extern pros::Imu imu;
extern pros::Rotation horiz_tracker;
extern pros::Distance dist_sensor;

// LemLib Controllers & Chassis Object
extern lemlib::Drivetrain drivetrain;
extern lemlib::ControllerSettings lateral_controller;
extern lemlib::ControllerSettings angular_controller;
extern lemlib::OdomSensors sensors;
extern lemlib::Chassis chassis;
`,

    "src/robot-config.cpp": `// =================================================================
// robot-config.cpp - Hardware Port Definitions & Controller Setup
// =================================================================
#include "main.h"
#include "robot-config.h"

// Drivetrain 6-Motor 600 RPM Cartridge Setup (Blue)
pros::Motor left_front(1, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor left_middle(2, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor left_back(3, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);

pros::Motor right_front(-11, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor right_middle(-12, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor right_back(-13, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);

pros::MotorGroup left_motors({left_front, left_middle, left_back});
pros::MotorGroup right_motors({right_front, right_middle, right_back});

// Subsystems
pros::Motor intake(7, pros::v5::MotorGears::blue);
pros::Motor lift(8, pros::v5::MotorGears::green);
pros::adi::DigitalOut clamp('A', false);
pros::adi::DigitalOut doinker('B', false);
pros::adi::DigitalOut intake_lift('C', false);

// Sensors
pros::Imu imu(10);
pros::Rotation horiz_tracker(9);
pros::Distance dist_sensor(15);

// Tracking Wheel Setup
lemlib::TrackingWheel horiz_wheel(&horiz_tracker, lemlib::Omniwheel::NEW_2, -2.5);

// LemLib Drivetrain Configuration (12" Track Width, 3.25" Wheels, 600 RPM)
lemlib::Drivetrain drivetrain(
    &left_motors,
    &right_motors,
    12.0, // track width (inches)
    lemlib::Omniwheel::NEW_325, // wheel diameter
    600.0, // drivetrain RPM
    2.0 // horizontal drift scaler
);

// Lateral PID Controller
lemlib::ControllerSettings lateral_controller(
    8.0, // kP
    0.0, // kI
    30.0, // kD
    3.0, // anti-windup range
    1.0, // small error range (in)
    100, // small error timeout (ms)
    3.0, // large error range (in)
    500, // large error timeout (ms)
    0 // slew rate
);

// Angular PID Controller
lemlib::ControllerSettings angular_controller(
    2.0, // kP
    0.0, // kI
    10.0, // kD
    3.0, // anti-windup range
    1.0, // small error range (deg)
    100, // small error timeout (ms)
    3.0, // large error range (deg)
    500, // large error timeout (ms)
    0 // slew rate
);

// Odometry Sensors
lemlib::OdomSensors sensors(
    nullptr, // vertical tracking wheel 1
    nullptr, // vertical tracking wheel 2
    &horiz_wheel, // horizontal tracking wheel
    nullptr, // horizontal tracking wheel 2
    &imu // inertial sensor
);

// LemLib Chassis Object
lemlib::Chassis chassis(drivetrain, lateral_controller, angular_controller, sensors);
`,

    "include/subsystems.hpp": `// =================================================================
// subsystems.hpp - Helper Functions for Subsystem Control
// =================================================================
#pragma once
#include "main.h"

// Subsystem Control Functions
void setIntake(int speed);
void setClamp(bool clamped);
void setDoinker(bool deployed);
void setLift(int position);
`,

    "src/subsystems.cpp": `// =================================================================
// subsystems.cpp - Implementation of Subsystem Control Helpers
// =================================================================
#include "main.h"
#include "robot-config.h"
#include "subsystems.hpp"

void setIntake(int speed) {
    intake.move(speed);
}

void setClamp(bool clamped) {
    clamp.set_value(clamped);
}

void setDoinker(bool deployed) {
    doinker.set_value(deployed);
}

void setLift(int position) {
    lift.move_absolute(position, 100);
}
`,

    "src/main.cpp": `// =================================================================
// main.cpp - PROS Competition Lifecycle Handlers
// =================================================================
#include "main.h"
#include "robot-config.h"
#include "subsystems.hpp"

// Autonomous declaration in autons.cpp
extern void red_rush_auton();
extern void blue_solo_awp();
extern void skills_auton();

void initialize() {
    pros::lcd::initialize();
    chassis.calibrate();
    pros::lcd::set_text(1, "LemLib Chassis Initialized");

    // Standard PROS background task to stream robot battery & LemLib odometry over serial CDC
    pros::Task telemetry_task([]{
        while (true) {
            printf("[BATT] %.2fV %d%%\\n", pros::battery::get_voltage() / 1000.0, (int)pros::battery::get_capacity());
            lemlib::Pose pose = chassis.getPose();
            printf("ODOM: X=%.2f Y=%.2f H=%.2f\\n", pose.x, pose.y, pose.theta);
            pros::delay(2000);
        }
    });
}

void disabled() {}

void competition_initialize() {}

void autonomous() {
    // Call selected autonomous routine
    red_rush_auton();
}

void opcontrol() {
    pros::Controller master(pros::E_CONTROLLER_MASTER);
    while (true) {
        // Arcade drive control
        int leftY = master.get_analog(pros::E_CONTROLLER_ANALOG_LEFT_Y);
        int rightX = master.get_analog(pros::E_CONTROLLER_ANALOG_RIGHT_X);
        chassis.arcade(leftY, rightX);

        // Subsystem buttons
        if (master.get_digital(pros::E_CONTROLLER_DIGITAL_R1)) intake.move(127);
        else if (master.get_digital(pros::E_CONTROLLER_DIGITAL_R2)) intake.move(-127);
        else intake.move(0);

        if (master.get_digital_new_press(pros::E_CONTROLLER_DIGITAL_L1)) {
            static bool clampState = false;
            clampState = !clampState;
            clamp.set_value(clampState);
        }

        pros::delay(10);
    }
}
`,

    "include/main.h": `// =================================================================
// main.h - PROS Standard Include Header
// =================================================================
#pragma once
#include "api.h"
#include "lemlib/api.hpp"
`,

    "Makefile": `# =================================================================
# VEX V5 PROS Makefile with LemLib
# =================================================================
CC = arm-none-eabi-gcc
CXX = arm-none-eabi-g++
PROJECT = robot-code
SRCDIR = src
INCDIR = include
BINDIR = bin

WARNFLAGS = -Wall -Wextra -Wno-unused-parameter
CXXFLAGS = -std=gnu++20 -O2 -mcpu=cortex-a9 -mfpu=neon -mfloat-abi=hard $(WARNFLAGS)
`,

    "project.pros": `{
    "py/object": "pros.conductor.project.Project",
    "py/state": {
        "project_name": "VEX_LemLib_OverRide_2026",
        "target": "v5",
        "templates": {
            "kernel": {"version": "4.1.0"},
            "lemlib": {"version": "0.5.4"}
        }
    }
}`
  };

  const LIBRARY_TEMPLATES = {
    lemlib: DEFAULT_TEMPLATES,
    ez_template: {
      "src/autons.cpp": `// =================================================================
// autons.cpp - Autonomous Routines for VEX V5 EZ-Template (v3+)
// =================================================================
#include "main.h"
#include "robot-config.h"
#include "subsystems.hpp"

const int DRIVE_SPEED = 110;
const int TURN_SPEED = 90;
const int SWING_SPEED = 110;

// -----------------------------------------------------------------
// Routine 1: Red Mogo Rush & Preload
// -----------------------------------------------------------------
void red_rush_auton() {
    chassis.odom_xyt_set(-60_in, -60_in, 0_deg);
    intake.move(127);

    chassis.pid_odom_set({{-24_in, -24_in}, ez::fwd, DRIVE_SPEED});
    chassis.pid_wait_quick_chain();

    chassis.pid_odom_set({{0_in, 48_in, 90_deg}, ez::rev, 95});
    chassis.pid_wait_until(12_in);
    clamp.set_value(true);
    chassis.pid_wait();

    chassis.pid_turn_set(180_deg, TURN_SPEED);
    chassis.pid_wait();
}

// -----------------------------------------------------------------
// Routine 2: Blue Solo AWP
// -----------------------------------------------------------------
void blue_solo_awp() {
    chassis.odom_xyt_set(60_in, -60_in, 0_deg);
    intake.move(127);
    chassis.pid_odom_set({{24_in, -24_in}, ez::fwd, DRIVE_SPEED});
    chassis.pid_wait();
    clamp.set_value(true);
    chassis.pid_turn_set(270_deg, TURN_SPEED);
    chassis.pid_wait();
}

// -----------------------------------------------------------------
// Routine 3: Autonomous Skills Routine (60s)
// -----------------------------------------------------------------
void skills_auton() {
    chassis.odom_xyt_set(-60_in, 0_in, 90_deg);
    intake.move(127);
    chassis.pid_drive_set(24_in, DRIVE_SPEED);
    chassis.pid_wait();
    clamp.set_value(true);
    chassis.pid_swing_set(ez::LEFT_SWING, 0_deg, SWING_SPEED);
    chassis.pid_wait();
}
`,
      "include/robot-config.h": `// =================================================================
// robot-config.h - EZ-Template Hardware & Chassis Declarations
// =================================================================
#pragma once
#include "main.h"
#include "EZ-Template/api.hpp"

extern pros::Motor intake;
extern pros::Motor lift;
extern pros::adi::DigitalOut clamp;
extern pros::adi::DigitalOut doinker;

extern ez::Drive chassis;
`,
      "src/robot-config.cpp": `// =================================================================
// robot-config.cpp - EZ-Template Drive & PID Constants Setup
// =================================================================
#include "main.h"
#include "robot-config.h"

pros::Motor intake(7, pros::v5::MotorGears::blue);
pros::Motor lift(8, pros::v5::MotorGears::green);
pros::adi::DigitalOut clamp('A', false);
pros::adi::DigitalOut doinker('B', false);

// EZ-Template Chassis Constructor
ez::Drive chassis(
    {1, 2, 3},      // Left Motors
    {-11, -12, -13}, // Right Motors
    10,              // IMU Port
    3.25,            // Wheel Diameter (in)
    600              // Wheel RPM
);

void default_constants() {
    chassis.pid_drive_constants_set(20.0, 0.0, 100.0);
    chassis.pid_heading_constants_set(11.0, 0.0, 20.0);
    chassis.pid_turn_constants_set(3.0, 0.05, 20.0, 15.0);
    chassis.pid_swing_constants_set(6.0, 0.0, 65.0);

    chassis.pid_drive_exit_condition_set(90_ms, 1_in, 250_ms, 3_in, 500_ms, 500_ms);
    chassis.pid_turn_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 500_ms);
    chassis.pid_swing_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 500_ms);
}
`,
      "include/subsystems.hpp": `#pragma once
#include "main.h"

void setIntake(int speed);
void setClamp(bool clamped);
`,
      "src/subsystems.cpp": `#include "main.h"
#include "robot-config.h"
#include "subsystems.hpp"

void setIntake(int speed) {
    intake.move(speed);
}

void setClamp(bool clamped) {
    clamp.set_value(clamped);
}
`,
      "src/main.cpp": `// =================================================================
// main.cpp - PROS Competition Entry Point (EZ-Template)
// =================================================================
#include "main.h"
#include "robot-config.h"
#include "subsystems.hpp"

extern void default_constants();
extern void red_rush_auton();

void initialize() {
    pros::delay(500);
    chassis.opcontrol_curve_buttons_toggle(true);
    default_constants();
    chassis.initialize();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
    chassis.pid_targets_reset();
    chassis.drive_imu_reset();
    chassis.drive_sensor_reset();
    chassis.drive_brake_set(MOTOR_BRAKE_HOLD);
    red_rush_auton();
}

void opcontrol() {
    pros::Controller master(pros::E_CONTROLLER_MASTER);
    while (true) {
        chassis.opcontrol_arcade_standard(ez::SPLIT);
        if (master.get_digital(pros::E_CONTROLLER_DIGITAL_R1)) intake.move(127);
        else if (master.get_digital(pros::E_CONTROLLER_DIGITAL_R2)) intake.move(-127);
        else intake.move(0);
        pros::delay(ez::util::DELAY_TIME);
    }
}
`,
      "include/main.h": `#pragma once
#include "api.h"
#include "EZ-Template/api.hpp"
`,
      "project.pros": `{
    "py/object": "pros.conductor.project.Project",
    "py/state": {
        "project_name": "VEX_EZ_Template_OverRide",
        "target": "v5",
        "templates": {
            "kernel": {"version": "4.1.0"},
            "EZ-Template": {"version": "3.1.1"}
        }
    }
}`
    },
    rw_template: {
      "src/autons.cpp": `// =================================================================
// autons.cpp - Autonomous Routines for VEXcode RW-Template
// =================================================================
#include "vex.h"
#include "robot-config.h"

// -----------------------------------------------------------------
// Routine 1: Red Mogo Rush & Preload
// -----------------------------------------------------------------
void red_rush_auton() {
    setOdom(-60, -60, 0);
    intake.spin(fwd, 12, volt);

    moveToPoint(-24, -24, 1, 2000);
    moveToPoint(0, 48, -1, 2500);
    clamp.set(true);
    wait(200, msec);

    turnToAngle(180, 1500);
    driveTo(24, 1500);
}

// -----------------------------------------------------------------
// Routine 2: Blue Solo AWP
// -----------------------------------------------------------------
void blue_solo_awp() {
    setOdom(60, -60, 0);
    intake.spin(fwd, 12, volt);
    moveToPoint(24, -24, 1, 2200);
    clamp.set(true);
    turnToAngle(270, 1400);
}

// -----------------------------------------------------------------
// Routine 3: Autonomous Skills Routine (60s)
// -----------------------------------------------------------------
void skills_auton() {
    setOdom(-60, 0, 90);
    intake.spin(fwd, 12, volt);
    driveTo(24, 1600);
    clamp.set(true);
    swing(0, 1, 1400);
}
`,
      "include/robot-config.h": `// =================================================================
// robot-config.h - RW-Template VEXcode Hardware & Motion API
// =================================================================
#pragma once
#include "vex.h"

extern vex::brain Brain;
extern vex::controller Controller1;
extern vex::motor intake;
extern vex::motor lift;
extern vex::digital_out clamp;
extern vex::inertial Inertial;

void setOdom(double x, double y, double theta);
void moveToPoint(double x, double y, int dir, int timeout, double exit = 0.5, double max_output = 12);
void driveTo(double distance_in, int timeout, double exit = 0.5, double max_output = 12);
void turnToAngle(double angle_deg, int timeout, double exit = 1.0, double max_output = 12);
void turnToPoint(double x, double y, int dir, int timeout);
void swing(double angle_deg, int dir, int timeout);
`,
      "src/robot-config.cpp": `// =================================================================
// robot-config.cpp - RW-Template Motors, Sensors & PID Constants
// =================================================================
#include "vex.h"
#include "robot-config.h"

vex::brain Brain;
vex::controller Controller1(vex::controllerType::primary);

vex::motor left_front(vex::PORT1, vex::ratio6_1, false);
vex::motor left_middle(vex::PORT2, vex::ratio6_1, false);
vex::motor left_back(vex::PORT3, vex::ratio6_1, false);
vex::motor right_front(vex::PORT11, vex::ratio6_1, true);
vex::motor right_middle(vex::PORT12, vex::ratio6_1, true);
vex::motor right_back(vex::PORT13, vex::ratio6_1, true);

vex::motor_group left_motors(left_front, left_middle, left_back);
vex::motor_group right_motors(right_front, right_middle, right_back);

vex::motor intake(vex::PORT7, vex::ratio6_1, false);
vex::motor lift(vex::PORT8, vex::ratio18_1, false);
vex::digital_out clamp(Brain.ThreeWirePort.A);
vex::inertial Inertial(vex::PORT10);

// RW-Template Physical Geometry & PID Gains
double wheel_diam = 3.25;
double drive_rpm = 600.0;
double track_width = 12.0;
double lateral_kp = 8.0, lateral_ki = 0.0, lateral_kd = 30.0;
double angular_kp = 2.0, angular_ki = 0.0, angular_kd = 10.0;
`,
      "include/vex.h": `#pragma once
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include "v5.h"
#include "v5_vcs.h"

using namespace vex;
`,
      "src/main.cpp": `// =================================================================
// main.cpp - VEXcode V5 Competition Entry Point (RW-Template)
// =================================================================
#include "vex.h"
#include "robot-config.h"

extern void red_rush_auton();

vex::competition Competition;

void pre_auton(void) {
    Inertial.calibrate();
    while (Inertial.isCalibrating()) {
        wait(20, msec);
    }
}

void autonomous(void) {
    red_rush_auton();
}

void usercontrol(void) {
    while (true) {
        int forward = Controller1.Axis3.position();
        int turn = Controller1.Axis1.position();
        left_motors.spin(fwd, (forward + turn) * 0.12, volt);
        right_motors.spin(fwd, (forward - turn) * 0.12, volt);
        wait(20, msec);
    }
}

int main() {
    Competition.autonomous(autonomous);
    Competition.drivercontrol(usercontrol);
    pre_auton();
    while (true) {
        wait(100, msec);
    }
}
`
    },
    jar_template: {
      "src/autons.cpp": `// =================================================================
// autons.cpp - Autonomous Routines for VEXcode JAR-Template
// =================================================================
#include "vex.h"
#include "robot-config.h"

// -----------------------------------------------------------------
// Routine 1: Red Mogo Rush & Preload
// -----------------------------------------------------------------
void red_rush_auton() {
    chassis.set_coordinates(-60, -60, 0);
    intake.spin(fwd, 12, volt);

    chassis.drive_to_point(-24, -24);
    chassis.drive_to_pose(0, 48, 90);
    clamp.set(true);
    wait(200, msec);

    chassis.turn_to_angle(180);
    chassis.drive_distance(24);
}

// -----------------------------------------------------------------
// Routine 2: Blue Solo AWP
// -----------------------------------------------------------------
void blue_solo_awp() {
    chassis.set_coordinates(60, -60, 0);
    intake.spin(fwd, 12, volt);
    chassis.drive_to_point(24, -24);
    clamp.set(true);
    chassis.turn_to_angle(270);
}

// -----------------------------------------------------------------
// Routine 3: Autonomous Skills Routine (60s)
// -----------------------------------------------------------------
void skills_auton() {
    chassis.set_coordinates(-60, 0, 90);
    intake.spin(fwd, 12, volt);
    chassis.drive_distance(24);
    clamp.set(true);
    chassis.left_swing_to_angle(0);
}
`,
      "include/robot-config.h": `// =================================================================
// robot-config.h - JAR-Template VEXcode Hardware & Drive Declarations
// =================================================================
#pragma once
#include "vex.h"

extern vex::brain Brain;
extern vex::controller Controller1;
extern vex::motor intake;
extern vex::motor lift;
extern vex::digital_out clamp;
extern vex::inertial Inertial;
extern Drive chassis;
`,
      "src/robot-config.cpp": `// =================================================================
// robot-config.cpp - JAR-Template Drivetrain & PID Configuration
// =================================================================
#include "vex.h"
#include "robot-config.h"

vex::brain Brain;
vex::controller Controller1(vex::controllerType::primary);

vex::motor Left1(vex::PORT1, vex::ratio6_1, true);
vex::motor Left2(vex::PORT2, vex::ratio6_1, true);
vex::motor Left3(vex::PORT3, vex::ratio6_1, true);
vex::motor Right1(vex::PORT11, vex::ratio6_1, false);
vex::motor Right2(vex::PORT12, vex::ratio6_1, false);
vex::motor Right3(vex::PORT13, vex::ratio6_1, false);

vex::motor_group LeftDrive(Left1, Left2, Left3);
vex::motor_group RightDrive(Right1, Right2, Right3);
vex::motor intake(vex::PORT7, vex::ratio6_1, false);
vex::motor lift(vex::PORT8, vex::ratio18_1, false);
vex::digital_out clamp(Brain.ThreeWirePort.A);
vex::inertial Inertial(vex::PORT10);

Drive chassis(
    ZERO_TRACKER_NO_ODOM,
    LeftDrive,
    RightDrive,
    vex::PORT10,
    3.25,     // wheel diameter (in)
    1.0,      // external gear ratio
    360,      // gyro scale
    vex::PORT1,
    vex::PORT2,
    vex::PORT3,
    vex::PORT11,
    12.0,     // drive width (in)
    -2.5      // tracker offset
);

void default_constants() {
    chassis.set_drive_constants(10, 1.5, 0, 10, 0);
    chassis.set_heading_constants(6, .4, 0, 1, 0);
    chassis.set_turn_constants(12, .4, .03, 3, 15);
    chassis.set_swing_constants(12, .3, .001, 2, 15);
}
`,
      "include/vex.h": `#pragma once
#include <math.h>
#include <stdio.h>
#include "v5.h"
#include "v5_vcs.h"

using namespace vex;
`,
      "src/main.cpp": `// =================================================================
// main.cpp - VEXcode V5 Competition Entry Point (JAR-Template)
// =================================================================
#include "vex.h"
#include "robot-config.h"

extern void default_constants();
extern void red_rush_auton();

vex::competition Competition;

void pre_auton(void) {
    default_constants();
    Inertial.calibrate();
    while (Inertial.isCalibrating()) {
        wait(20, msec);
    }
}

void autonomous(void) {
    red_rush_auton();
}

void usercontrol(void) {
    while (true) {
        chassis.control_arcade();
        wait(20, msec);
    }
}

int main() {
    Competition.autonomous(autonomous);
    Competition.drivercontrol(usercontrol);
    pre_auton();
    while (true) {
        wait(100, msec);
    }
}
`
    }
  };

  function normalizeLibId(raw) {
    if (typeof window !== "undefined" && window.CppTranslator && typeof window.CppTranslator.normalizeLibraryId === "function") {
      return window.CppTranslator.normalizeLibraryId(raw);
    }
    const v = String(raw || "lemlib").trim().toLowerCase();
    if (v === "ez" || v === "ez-template" || v === "ez_template") return "ez_template";
    if (v === "rw" || v === "rw-template" || v === "rw_template") return "rw_template";
    if (v === "jar" || v === "jar-template" || v === "jar_template") return "jar_template";
    return "lemlib";
  }

  class ProjectManager {
    constructor() {
      this.project = null;
      this.isDirty = false;
      this.changedFiles = new Set();
      this.lastSavedFileHashes = new Map();
      this.listeners = [];
      this.versions = {};
      this._activeVersionFile = "src/autons.cpp";
      this._selectedVersionId = null;
      this._versionDiffActive = false;
      this.loadProject();
      this.readyPromise = this.initAsyncStorage();
      this.initVersionHistory();
    }

    async whenReady() {
      if (this.readyPromise) {
        await this.readyPromise;
      }
      return this.project;
    }

    recordSavedBaseline() {
      if (!this.project || !this.project.files) return;
      this.lastSavedFileHashes.clear();
      for (const [filename, content] of Object.entries(this.project.files)) {
        this.lastSavedFileHashes.set(filename, typeof content === "string" ? content : "");
      }
      this.changedFiles.clear();
    }

    async initAsyncStorage() {
      try {
        const idbProj = await idbGet(IDB_PROJECT_KEY);
        if (idbProj && idbProj.files && Object.keys(idbProj.files).length > 0) {
          const currentTimestamp = this.project?.updatedAt || 0;
          const idbTimestamp = idbProj.updatedAt || 0;
          // If IDB has a valid project and either we don't have one or IDB is strictly fresher
          // or current in-memory project was just a placeholder (_idb) or missing files
          const needsLoad = !this.project ||
            this.project._idb ||
            !this.project.files ||
            Object.keys(this.project.files).length === 0 ||
            (idbTimestamp > currentTimestamp && !this.isDirty);

          if (needsLoad) {
            this.project = idbProj;
            this.isDirty = localStorage.getItem(STORAGE_KEY_PROJECT_DIRTY) === "true";
            this.recordSavedBaseline();
            this.indexVariables();
            this.notifyListeners("load");
          }
        } else if (this.project && !this.project._idb) {
          // Sync existing project into IDB
          await idbPut(IDB_PROJECT_KEY, this.project);
        }
      } catch (err) {
        console.warn("Async storage sync warning:", err);
      }
      return this.project;
    }

    getTemplatesForLibrary(libId) {
      const id = normalizeLibId(libId);
      return LIBRARY_TEMPLATES[id] || DEFAULT_TEMPLATES;
    }

    getProjectLibrary() {
      if (this.project && this.project.library) {
        return normalizeLibId(this.project.library);
      }
      if (this.project && this.project.files && typeof window !== "undefined" && window.CppTranslator && typeof window.CppTranslator.detectLibraryFromCode === "function") {
        const combined = (this.project.files["src/autons.cpp"] || "") + "\n" + (this.project.files["src/robot-config.cpp"] || "") + "\n" + (this.project.files["src/main.cpp"] || "");
        if (combined.trim()) {
          return normalizeLibId(window.CppTranslator.detectLibraryFromCode(combined));
        }
      }
      try {
        const saved = localStorage.getItem("vex_active_library");
        if (saved) return normalizeLibId(saved);
      } catch (_) {}
      return "lemlib";
    }

    setProjectLibrary(libId, options = {}) {
      if (!this.project) this.initDefaultProject();
      const norm = normalizeLibId(libId);
      this.project.library = norm;
      try {
        localStorage.setItem("vex_active_library", norm);
      } catch (_) {}

      const defaultNames = ["Override_LemLib_Bot", "Override_EZ_Bot", "Override_RW_Bot", "Override_JAR_Bot"];
      if (defaultNames.includes(this.project.name)) {
        const nameMap = {
          lemlib: "Override_LemLib_Bot",
          ez_template: "Override_EZ_Bot",
          rw_template: "Override_RW_Bot",
          jar_template: "Override_JAR_Bot",
        };
        this.project.name = nameMap[norm] || "Override_VEX_Bot";
      }

      if (options.applyTemplate) {
        const tpl = this.getTemplatesForLibrary(norm);
        const includeAutons = options.replaceAutons !== false;
        Object.keys(this.project.files || {}).forEach((existingFile) => {
          if (existingFile !== "src/autons.cpp" && tpl[existingFile] === undefined) {
            // Preserve user custom files unless they are old template config files being swapped
            if (["include/main.h", "include/vex.h", "project.pros", "Makefile", "include/subsystems.hpp", "src/subsystems.cpp"].includes(existingFile)) {
              delete this.project.files[existingFile];
            }
          }
        });
        for (const [fPath, fContent] of Object.entries(tpl)) {
          if (fPath === "src/autons.cpp" && !includeAutons) continue;
          if (this.project.files[fPath]) {
            this.createVersionSnapshot(fPath, "before_blocks_sync", `Backup before switching template to ${norm}`);
          }
          this.project.files[fPath] = fContent;
        }
        if (!includeAutons) {
          this.project.files["src/autons.cpp"] = this.project.files["src/autons.cpp"] || tpl["src/autons.cpp"];
        }
      }

      this.project.updatedAt = Date.now();
      this.indexVariables();
      this.saveLocal(true);
      this.notifyListeners("library_changed");
      return norm;
    }

    // Load active project from LocalStorage or initialize default
    loadProject() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_PROJECT);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed._idb) {
            // Full project is in IndexedDB; initAsyncStorage will populate it
            if (!this.project) {
              const lib = normalizeLibId(parsed.library || "lemlib");
              this.project = {
                name: parsed.name || "Override_LemLib_Bot",
                library: lib,
                version: parsed.version || "1.0.0",
                target: "v5",
                kernel: "4.1.0",
                lemlibVersion: "0.5.4",
                createdAt: parsed.updatedAt || Date.now(),
                updatedAt: parsed.updatedAt || Date.now(),
                files: { ...this.getTemplatesForLibrary(lib) },
                activeAuton: "red_rush_auton",
                cloudSynced: true,
                _idb: true
              };
            }
          } else {
            this.project = parsed;
            if (!this.project.library) {
              this.project.library = this.getProjectLibrary();
            }
            if (!this.project.files || Object.keys(this.project.files).length === 0) {
              this.project.files = { ...this.getTemplatesForLibrary(this.project.library) };
            }
          }
        } else {
          this.initDefaultProject();
        }
      } catch (e) {
        console.error("Failed to load project from storage:", e);
        this.initDefaultProject();
      }

      this.isDirty = localStorage.getItem(STORAGE_KEY_PROJECT_DIRTY) === "true";
      this.recordSavedBaseline();
      this.indexVariables();
      return this.project;
    }

    initDefaultProject(name = "Override_LemLib_Bot", library = null) {
      let activeLib = library;
      if (!activeLib) {
        try { activeLib = localStorage.getItem("vex_active_library") || "lemlib"; } catch (_) { activeLib = "lemlib"; }
      }
      activeLib = normalizeLibId(activeLib);
      this.project = {
        name: name,
        library: activeLib,
        version: "1.0.0",
        target: "v5",
        kernel: "4.1.0",
        lemlibVersion: "0.5.4",
        createdAt: 0,
        updatedAt: 0,
        files: { ...this.getTemplatesForLibrary(activeLib) },
        activeAuton: "red_rush_auton",
        cloudSynced: false,
        isDefault: true,
      };
      this.saveLocal();
      this.recordSavedBaseline();
    }

    isDefaultProject() {
      if (!this.project) return true;
      if (this.project.isDefault === true) return true;
      if ((Number(this.project.updatedAt) || 0) === 0) return true;
      const files = this.project.files || {};
      const keys = Object.keys(files);
      const activeTpl = this.getTemplatesForLibrary(this.getProjectLibrary());
      const defaultKeys = Object.keys(activeTpl);
      if (keys.length === 0) return true;
      if (keys.length === defaultKeys.length) {
        const isExactTemplates = defaultKeys.every(k => files[k] !== undefined && files[k] === activeTpl[k]);
        if (isExactTemplates) return true;
      }
      return false;
    }

    cleanFilesForFirestore(files) {
      if (!files || typeof files !== "object") return {};
      const clean = {};
      const IGNORED_PATH_PREFIXES = [
        ".cache/",
        ".clangd/",
        ".vscode/",
        ".git/",
        "bin/",
        "build/",
        "firmware/",
        "dist/",
        "node_modules/"
      ];
      const IGNORED_EXTENSIONS = [
        ".idx", ".bin", ".elf", ".o", ".a", ".d", ".map", ".gch", ".pch",
        ".so", ".dylib", ".dll", ".exe", ".zip", ".tar", ".gz", ".7z", ".iso"
      ];

      for (const [rawPath, content] of Object.entries(files)) {
        if (!rawPath || typeof content !== "string") continue;
        const normPath = rawPath.replace(/\\/g, "/");

        // Check ignored prefixes
        const isIgnoredPrefix = IGNORED_PATH_PREFIXES.some(prefix => normPath.startsWith(prefix) || normPath.includes("/" + prefix));
        if (isIgnoredPrefix) {
          console.log(`[ProjectManager] Skipping cache/build artifact for cloud sync: ${normPath}`);
          continue;
        }

        // Check ignored extensions
        const lowerPath = normPath.toLowerCase();
        const isIgnoredExt = IGNORED_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
        if (isIgnoredExt) {
          console.log(`[ProjectManager] Skipping binary/indexer file for cloud sync: ${normPath}`);
          continue;
        }

        // Skip binary content if present
        if (content.indexOf("\0") !== -1) {
          console.warn(`[ProjectManager] Skipping binary null-byte file for cloud sync: ${normPath}`);
          continue;
        }
        // Skip single files larger than 1.5MB
        if (content.length > 1.5 * 1024 * 1024) {
          console.warn(`[ProjectManager] Skipping oversized file for cloud sync: ${normPath} (${content.length} bytes)`);
          continue;
        }
        clean[normPath] = content;
      }
      return clean;
    }

    wipeProject() {
      try {
        localStorage.removeItem(STORAGE_KEY_PROJECT);
        localStorage.removeItem(STORAGE_KEY_PROJECT_DIRTY);
      } catch (e) {
        console.error("Wipe storage error:", e);
      }
      idbDelete(IDB_PROJECT_KEY);
      this.project = null;
      this.isDirty = false;
      this.notifyListeners("wipe");
    }

    async exportProjectZip() {
      if (!this.project) return;
      const projName = this.project.name || "Override_LemLib_Bot";
      
      if (typeof JSZip !== "undefined") {
        try {
          const zip = new JSZip();
          const folder = zip.folder(projName);
          const files = this.project.files || {};
          for (const [filename, content] of Object.entries(files)) {
            folder.file(filename, content);
          }
          const blob = await zip.generateAsync({ type: "blob" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${projName}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        } catch (e) {
          console.warn("JSZip export failed, falling back to JSON export:", e);
        }
      }
      this.exportProjectJson();
    }

    exportProjectJson() {
      if (!this.project) return;
      const json = JSON.stringify(this.project, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${this.project.name || "Override_LemLib_Project"}_backup.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    getProjectSizeBytes() {
      if (!this.project) return 0;
      let bytes = 0;
      if (this.project.files) {
        for (const [name, content] of Object.entries(this.project.files)) {
          bytes += (name.length + 4);
          if (typeof content === "string") {
            bytes += (typeof Blob !== "undefined" ? new Blob([content]).size : content.length * 2);
          }
        }
      }
      return Math.max(bytes, 512);
    }

    getChangedSizeBytes() {
      if (!this.project || !this.project.files) return 0;
      if (!this.changedFiles || this.changedFiles.size === 0) {
        return this.isDirty ? 512 : 0;
      }
      let bytes = 0;
      for (const filename of this.changedFiles) {
        const content = this.project.files[filename] || "";
        bytes += (filename.length + 4);
        if (typeof content === "string") {
          bytes += (typeof Blob !== "undefined" ? new Blob([content]).size : content.length * 2);
        }
      }
      return Math.max(bytes, 512);
    }

    formatBytes(bytes) {
      if (!bytes || bytes <= 0) return "0 B";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    formatSavingProgress(savedBytes, totalBytes) {
      if (!totalBytes || totalBytes <= 0) {
        if (!savedBytes || savedBytes <= 0) {
          return "0.00MB/0.00MB(100%)";
        }
        totalBytes = savedBytes;
      }
      const safeTotal = Math.max(savedBytes, totalBytes);
      let curMB = (savedBytes / (1024 * 1024)).toFixed(2);
      let totMB = (safeTotal / (1024 * 1024)).toFixed(2);
      
      // Ensure that small files/edits under 10KB don't display 0.00MB/0.00MB
      if (totMB === "0.00") {
        totMB = "0.01";
      }
      let pct = Math.round((savedBytes / safeTotal) * 100);
      if (savedBytes > 0 && pct === 0) {
        pct = 1; // Never display 0% once bytes have been saved
      }
      if (pct >= 100 || savedBytes >= safeTotal) {
        curMB = totMB;
        pct = 100;
      }
      return `${curMB}MB/${totMB}MB(${pct}%)`;
    }

    // Save ONLY the modified/changed files (Delta Saving)
    async saveChangesOnly(onProgress = null, skipIndex = false) {
      if (!this.project) return 0;

      const hasUnsaved = this.isDirty || (this.changedFiles && this.changedFiles.size > 0);
      const totalBytes = this.getChangedSizeBytes() || (hasUnsaved ? 512 : 0);

      if (totalBytes === 0 && !hasUnsaved) {
        if (typeof onProgress === "function") {
          onProgress(0, 0, this.formatSavingProgress(0, 0));
        }
        return 0;
      }

      this.project.updatedAt = Date.now();

      const emit = (curr) => {
        const clamped = Math.min(curr, totalBytes);
        if (typeof onProgress === "function") {
          try {
            onProgress(clamped, totalBytes, this.formatSavingProgress(clamped, totalBytes));
          } catch (e) {
            console.error("Save changes progress error:", e);
          }
        }
      };

      // Always begin with non-zero progress (never stuck at 0%)
      emit(Math.max(1, Math.round(totalBytes * 0.25)));

      // 1. Asynchronously persist project to IndexedDB
      await idbPut(IDB_PROJECT_KEY, this.project);
      emit(Math.round(totalBytes * 0.65));

      // 2. Mirror to localStorage
      try {
        localStorage.setItem(STORAGE_KEY_PROJECT, JSON.stringify(this.project));
        localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
      } catch (e) {
        try {
          localStorage.setItem(STORAGE_KEY_PROJECT, JSON.stringify({
            _idb: true,
            name: this.project.name || "Override_LemLib_Bot",
            version: this.project.version || "1.0.0",
            updatedAt: this.project.updatedAt,
            fileCount: Object.keys(this.project.files || {}).length
          }));
          localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
        } catch (innerErr) {}
      }
      emit(Math.round(totalBytes * 0.90));

      if (!skipIndex) {
        this.indexVariables();
      }

      // Changes have been safely committed
      this.changedFiles.clear();
      this.isDirty = false;
      this.recordSavedBaseline();

      emit(totalBytes);
      this.notifyListeners("save");
      return totalBytes;
    }

    async saveWithProgress(onProgress, skipIndex = false) {
      if (!this.project) return 0;
      const totalBytes = this.getProjectSizeBytes();
      this.project.updatedAt = Date.now();

      const emit = (curr) => {
        const clamped = Math.min(curr, totalBytes);
        if (typeof onProgress === "function") {
          try {
            onProgress(clamped, totalBytes, this.formatSavingProgress(clamped, totalBytes));
          } catch (e) {
            console.error("Save progress handler error:", e);
          }
        }
      };

      emit(Math.max(1, Math.round(totalBytes * 0.20)));

      // 1. Asynchronously persist full project to IndexedDB (multi-gigabyte capacity, never hits 5MB quota)
      await idbPut(IDB_PROJECT_KEY, this.project);
      emit(Math.round(totalBytes * 0.60));

      // 2. Attempt to mirror to localStorage for instantaneous fast boot
      try {
        localStorage.setItem(STORAGE_KEY_PROJECT, JSON.stringify(this.project));
        localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
      } catch (e) {
        try {
          localStorage.setItem(STORAGE_KEY_PROJECT, JSON.stringify({
            _idb: true,
            name: this.project.name || "Override_LemLib_Bot",
            version: this.project.version || "1.0.0",
            updatedAt: this.project.updatedAt,
            fileCount: Object.keys(this.project.files || {}).length
          }));
          localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
        } catch (innerErr) {
          try {
            localStorage.removeItem(STORAGE_KEY_PROJECT);
            localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
          } catch (ign) {}
        }
      }
      emit(Math.round(totalBytes * 0.88));

      if (!skipIndex) {
        this.indexVariables();
      }

      this.changedFiles.clear();
      this.isDirty = false;
      this.recordSavedBaseline();

      emit(totalBytes);
      this.notifyListeners("save");
      return totalBytes;
    }

    async saveLocal(skipIndex = false, onProgress = null) {
      if (!this.project) return;
      if (typeof onProgress === "function") {
        return this.saveChangesOnly(onProgress, skipIndex);
      }
      this.project.updatedAt = Date.now();

      // 1. Asynchronously persist full project to IndexedDB and await
      await idbPut(IDB_PROJECT_KEY, this.project);

      // 2. Mirror to localStorage
      try {
        localStorage.setItem(STORAGE_KEY_PROJECT, JSON.stringify(this.project));
        localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
      } catch (e) {
        try {
          localStorage.setItem(STORAGE_KEY_PROJECT, JSON.stringify({
            _idb: true,
            name: this.project.name || "Override_LemLib_Bot",
            version: this.project.version || "1.0.0",
            updatedAt: this.project.updatedAt,
            fileCount: Object.keys(this.project.files || {}).length
          }));
          localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
        } catch (innerErr) {
          try {
            localStorage.removeItem(STORAGE_KEY_PROJECT);
            localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, "false");
          } catch (ign) {}
        }
      }
      if (!skipIndex) {
        this.indexVariables();
      }
      this.changedFiles.clear();
      this.isDirty = false;
      this.recordSavedBaseline();
      this.notifyListeners("save");

      // Background Google Drive Autosave
      this.scheduleGoogleDriveAutosave();
    }

    scheduleGoogleDriveAutosave() {
      if (typeof window === "undefined" || !window.GoogleDriveSync) return;
      // CRITICAL: Only autosave if user has actually made edits AND project is not the untouched default!
      if (!this.project || this.project.isDefault || !this._hasUserEdited) {
        return;
      }

      if (this._gdriveDebounceTimer) clearTimeout(this._gdriveDebounceTimer);
      this._gdriveDebounceTimer = setTimeout(async () => {
        try {
          if (this.project && !this.project.isDefault && this._hasUserEdited && window.GoogleDriveSync) {
            await window.GoogleDriveSync.saveProject(this.project);
            console.log(`[GoogleDriveAutosave] Auto-synced user project '${this.project.name}' to Google Drive.`);
          }
        } catch (e) {
          console.warn("[GoogleDriveAutosave] Background sync notice:", e.message);
        }
      }, 1500);
    }

    markDirty(dirty = true) {
      this.isDirty = dirty;
      if (dirty) {
        this._hasUserEdited = true;
        if (this.project) {
          this.project.isDefault = false;
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY_PROJECT_DIRTY, dirty ? "true" : "false");
      } catch (e) {}
      this.notifyListeners("dirty");
    }

    // Normalizes file structures from imported folder trees, ZIP archives, and JSON dumps
    normalizeFiles(filesMap) {
      if (!filesMap || typeof filesMap !== "object") return {};
      const normalized = {};

      // 1. Sanitize keys: backslashes to slashes, strip leading ./ and /, trim
      for (const [rawKey, rawContent] of Object.entries(filesMap)) {
        if (!rawKey) continue;
        const cleanKey = rawKey.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").trim();
        const content = typeof rawContent === "string" ? rawContent : String(rawContent || "");
        normalized[cleanKey] = content;
      }

      // 2. Canonical autonomous routine discovery & synchronization
      // Matches src/autons.cpp, autons.cpp, src/auton.cpp, auton.cpp, src/autonomous.cpp, autonomous.cpp
      const autonCandidates = [
        "src/autons.cpp",
        "autons.cpp",
        "src/auton.cpp",
        "auton.cpp",
        "src/autonomous.cpp",
        "autonomous.cpp"
      ];

      // Find first candidate key that has non-empty content
      let foundAutonKey = autonCandidates.find(k => normalized[k] && typeof normalized[k] === "string" && normalized[k].trim().length > 0);
      
      // Fallback: check any file with 'auton' in name ending in .cpp
      if (!foundAutonKey) {
        foundAutonKey = Object.keys(normalized).find(k => {
          const lk = k.toLowerCase();
          return lk.includes("auton") && lk.endsWith(".cpp") && normalized[k] && normalized[k].trim().length > 0;
        });
      }

      if (foundAutonKey) {
        const autonCode = normalized[foundAutonKey];
        // Ensure BOTH "src/autons.cpp" AND "autons.cpp" contain the imported routine
        normalized["src/autons.cpp"] = autonCode;
        normalized["autons.cpp"] = autonCode;
        console.log(`[ProjectManager] Successfully mapped imported autonomous code from "${foundAutonKey}" to "src/autons.cpp" (${autonCode.length} characters)`);
      }

      // 3. Canonical main.cpp discovery
      const mainKey = Object.keys(normalized).find(k => k === "src/main.cpp" || k === "main.cpp");
      if (mainKey && normalized[mainKey]) {
        normalized["src/main.cpp"] = normalized[mainKey];
        normalized["main.cpp"] = normalized[mainKey];
      }

      // 4. Canonical headers discovery
      const mainHKey = Object.keys(normalized).find(k => k === "include/main.h" || k === "main.h");
      if (mainHKey && normalized[mainHKey]) {
        normalized["include/main.h"] = normalized[mainHKey];
        normalized["main.h"] = normalized[mainHKey];
      }

      const robotConfigHKey = Object.keys(normalized).find(k => k === "include/robot-config.h" || k === "robot-config.h");
      if (robotConfigHKey && normalized[robotConfigHKey]) {
        normalized["include/robot-config.h"] = normalized[robotConfigHKey];
        normalized["robot-config.h"] = normalized[robotConfigHKey];
      }

      const robotConfigCppKey = Object.keys(normalized).find(k => k === "src/robot-config.cpp" || k === "robot-config.cpp");
      if (robotConfigCppKey && normalized[robotConfigCppKey]) {
        normalized["src/robot-config.cpp"] = normalized[robotConfigCppKey];
        normalized["robot-config.cpp"] = normalized[robotConfigCppKey];
      }

      return normalized;
    }

    getFile(filename) {
      if (!this.project || !this.project.files) return "";
      if (!filename || typeof filename !== "string") return "";

      // 1. Direct match
      const direct = this.project.files[filename];
      if (direct !== undefined && typeof direct === "string") {
        return direct;
      }

      // 2. Cleaned match
      const clean = filename.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").trim();
      if (this.project.files[clean] !== undefined && typeof this.project.files[clean] === "string") {
        return this.project.files[clean];
      }

      // 3. Robust alias resolution for autonomous C++ routines
      if (
        clean === "src/autons.cpp" ||
        clean === "autons.cpp" ||
        clean === "src/auton.cpp" ||
        clean === "auton.cpp" ||
        clean === "src/autonomous.cpp" ||
        clean === "autonomous.cpp"
      ) {
        const autonCandidates = [
          "src/autons.cpp",
          "autons.cpp",
          "src/auton.cpp",
          "auton.cpp",
          "src/autonomous.cpp",
          "autonomous.cpp"
        ];
        for (const candidate of autonCandidates) {
          const val = this.project.files[candidate];
          if (val !== undefined && typeof val === "string" && val.length > 0) {
            // Keep canonical primary keys in sync
            this.project.files["src/autons.cpp"] = val;
            this.project.files["autons.cpp"] = val;
            return val;
          }
        }
      }

      // 4. Robust alias resolution for main.cpp
      if (clean === "src/main.cpp" || clean === "main.cpp") {
        const val = this.project.files["src/main.cpp"] ?? this.project.files["main.cpp"];
        if (val !== undefined && typeof val === "string") {
          return val;
        }
      }

      // 5. Robust alias resolution for include/main.h
      if (clean === "include/main.h" || clean === "main.h") {
        const val = this.project.files["include/main.h"] ?? this.project.files["main.h"];
        if (val !== undefined && typeof val === "string") {
          return val;
        }
      }

      // 6. Robust alias resolution for robot-config
      if (clean === "include/robot-config.h" || clean === "robot-config.h") {
        const val = this.project.files["include/robot-config.h"] ?? this.project.files["robot-config.h"];
        if (val !== undefined && typeof val === "string") {
          return val;
        }
      }
      if (clean === "src/robot-config.cpp" || clean === "robot-config.cpp") {
        const val = this.project.files["src/robot-config.cpp"] ?? this.project.files["robot-config.cpp"];
        if (val !== undefined && typeof val === "string") {
          return val;
        }
      }

      // 7. Prefix fallbacks
      if (!clean.startsWith("src/") && this.project.files["src/" + clean] !== undefined) {
        return this.project.files["src/" + clean];
      }
      if (!clean.startsWith("include/") && this.project.files["include/" + clean] !== undefined) {
        return this.project.files["include/" + clean];
      }

      return "";
    }

    setFile(filename, content, immediate = false) {
      if (!this.project) this.initDefaultProject();
      if (!this.project.files) this.project.files = {};
      this.project.isDefault = false;
      this.project.updatedAt = Date.now();
      
      const clean = filename ? filename.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").trim() : filename;
      const baseline = this.lastSavedFileHashes.get(clean) ?? this.lastSavedFileHashes.get(filename);
      this.project.files[clean] = content;

      // Keep canonical aliases in sync
      if (clean === "src/autons.cpp" || clean === "autons.cpp") {
        this.project.files["src/autons.cpp"] = content;
        if (this.project.files["autons.cpp"] !== undefined) {
          this.project.files["autons.cpp"] = content;
        }
      } else if (clean === "src/main.cpp" || clean === "main.cpp") {
        this.project.files["src/main.cpp"] = content;
        if (this.project.files["main.cpp"] !== undefined) {
          this.project.files["main.cpp"] = content;
        }
      }

      if (baseline !== undefined && baseline === content) {
        this.changedFiles.delete(clean);
        if (this.changedFiles.size === 0) {
          this.markDirty(false);
        }
      } else {
        this.changedFiles.add(clean);
        this.markDirty(true);
      }

      if (immediate) {
        if (this.debounceSaveTimer) {
          clearTimeout(this.debounceSaveTimer);
          this.debounceSaveTimer = null;
        }
        this.saveChangesOnly();
      } else {
        this.scheduleDebouncedSave();
      }
    }

    scheduleDebouncedSave() {
      if (this.debounceSaveTimer) clearTimeout(this.debounceSaveTimer);
      this.debounceSaveTimer = setTimeout(() => {
        this.debounceSaveTimer = null;
        this.saveChangesOnly();
      }, 800);
    }

    // -------------------------------------------------------------
    // Versioning, Snapshots & Raw C++ Protection Engine
    // -------------------------------------------------------------
    async initVersionHistory() {
      try {
        const stored = await idbGet("file_versions_history");
        if (stored && typeof stored === "object") {
          this.versions = stored;
          // Enforce 50-version limit to prevent massive files in Google Drive
          for (const key in this.versions) {
            if (Array.isArray(this.versions[key])) {
              if (this.versions[key].length > 50) {
                this.versions[key].length = 50;
              }
            }
          }
          await idbPut("file_versions_history", this.versions).catch(() => {});
        } else {
          this.versions = {};
        }
      } catch (e) {
        this.versions = {};
      }

      // If src/autons.cpp exists and has no version snapshot yet, create initial baseline snapshot
      const autonsCode = this.getFile("src/autons.cpp");
      if (autonsCode && (!this.versions["src/autons.cpp"] || this.versions["src/autons.cpp"].length === 0)) {
        this.createVersionSnapshot("src/autons.cpp", "initial", "Initial Baseline C++ Auton", autonsCode);
      }
      this.updateVersionCountBadges();
      this.wireVersionHistoryUI();
    }

    createVersionSnapshot(fileName = "src/autons.cpp", source = "manual", label = "", explicitContent = null, authorInfo = null) {
      if (!fileName) fileName = "src/autons.cpp";
      const content = explicitContent !== null ? explicitContent : this.getFile(fileName);
      if (!content || typeof content !== "string" || content.trim().length === 0) return null;

      if (!this.versions) this.versions = {};
      if (!this.versions[fileName]) this.versions[fileName] = [];

      const list = this.versions[fileName];
      // Avoid duplicate consecutive identical snapshots
      if (list.length > 0 && list[0].content === content && source !== "manual") {
        return list[0];
      }

      const now = Date.now();
      const timeStr = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const dateStr = new Date(now).toLocaleDateString([], { month: "short", day: "numeric" });

      let defaultLabel = "Version Snapshot";
      if (source === "ide") defaultLabel = "Raw C++ Code Edit in IDE";
      else if (source === "before_blocks_sync") defaultLabel = "Preserved Raw C++ before Blocks Sync";
      else if (source === "blocks_merge") defaultLabel = "Blocks Merge & Overwrite";
      else if (source === "blocks_append") defaultLabel = "Blocks Append Routine";
      else if (source === "restore") defaultLabel = "Backup before Version Restore";
      else if (source === "manual") defaultLabel = "Manual Checkpoint";
      else if (source === "initial") defaultLabel = "Initial Workspace Baseline";

      const isTeam = Boolean(this.isTeam || this.project?.isTeam || (typeof window !== "undefined" && window.location && window.location.pathname.includes("team")));
      const auth = authorInfo || (typeof window !== "undefined" && window.currentUserTeamMember) || null;
      let userEmail = auth?.email || (typeof localStorage !== "undefined" ? localStorage.getItem("lemlib_saved_google_email") : "") || "";
      let userName = auth?.displayName || (userEmail ? userEmail.split("@")[0] : "Programmer");
      let userRole = auth?.role || "Programmer";

      const snapshot = {
        id: "v_" + now + "_" + Math.random().toString(36).substring(2, 7),
        fileName,
        content,
        timestamp: now,
        dateStr: `${dateStr} · ${timeStr}`,
        source,
        label: label || defaultLabel,
        linesCount: content.split("\n").length,
        sizeBytes: typeof Blob !== "undefined" ? new Blob([content]).size : content.length,
        authorEmail: userEmail,
        authorName: userName,
        authorRole: userRole,
        actionSummary: label || defaultLabel
      };

      list.unshift(snapshot);
      const maxLimit = isTeam ? 500 : 50;
      if (list.length > maxLimit) list.length = maxLimit;

      // Persist to IndexedDB asynchronously
      idbPut("file_versions_history", this.versions).catch(() => {});

      if (source === "ide" || source === "manual") {
        if (this.project) {
          this.project.lastAutonEditor = "ide";
          this.project.rawCppPreserved = true;
        }
      }

      this.notifyListeners("version_created", snapshot);
      this.updateVersionCountBadges();
      return snapshot;
    }

    getVersionHistory(fileName = "src/autons.cpp") {
      if (!this.versions) this.versions = {};
      return this.versions[fileName] || [];
    }

    restoreVersion(versionId, fileName = "src/autons.cpp") {
      const list = this.getVersionHistory(fileName);
      const target = list.find(v => v.id === versionId);
      if (!target) {
        throw new Error("Version snapshot not found: " + versionId);
      }

      // Auto-backup current state first so no state can ever be lost
      this.createVersionSnapshot(fileName, "restore", `Auto-Backup before Restoring (${target.label})`);

      // Overwrite file with target snapshot content
      this.setFile(fileName, target.content, false);
      if (this.project) {
        this.project.lastAutonEditor = "ide";
        this.project.rawCppPreserved = true;
      }
      this.markDirty(true);
      this.saveLocal().catch(() => {});

      this.notifyListeners("version_restored", target);
      this.updateVersionCountBadges();
      return target;
    }

    deleteVersion(versionId, fileName = "src/autons.cpp") {
      const list = this.getVersionHistory(fileName);
      const idx = list.findIndex(v => v.id === versionId);
      if (idx !== -1) {
        list.splice(idx, 1);
        idbPut("file_versions_history", this.versions).catch(() => {});
        this.notifyListeners("version_deleted", { versionId, fileName });
        this.updateVersionCountBadges();
        return true;
      }
      return false;
    }

    clearVersionHistory(fileName = "src/autons.cpp") {
      if (this.versions && this.versions[fileName]) {
        this.versions[fileName] = [];
        idbPut("file_versions_history", this.versions).catch(() => {});
        this.notifyListeners("version_cleared", { fileName });
        this.updateVersionCountBadges();
      }
    }

    diffLines(currentText, snapshotText) {
      const linesA = (currentText || "").split("\n");
      const linesB = (snapshotText || "").split("\n");
      const diff = [];
      const maxLines = Math.max(linesA.length, linesB.length);
      for (let i = 0; i < maxLines; i++) {
        const a = linesA[i];
        const b = linesB[i];
        if (a === undefined) {
          diff.push({ type: "added_in_snapshot", lineNum: i + 1, text: b });
        } else if (b === undefined) {
          diff.push({ type: "removed_in_snapshot", lineNum: i + 1, text: a });
        } else if (a === b) {
          diff.push({ type: "same", lineNum: i + 1, text: b });
        } else {
          diff.push({ type: "changed_in_snapshot", lineNum: i + 1, text: b, origText: a });
        }
      }
      return diff;
    }

    updateVersionCountBadges() {
      const list = this.getVersionHistory(this._activeVersionFile || "src/autons.cpp");
      const count = list.length;
      const ideBadge = document.getElementById("ideVersionCount");
      const bannerBadge = document.getElementById("bannerVersionCount");
      if (ideBadge) ideBadge.textContent = String(count);
      if (bannerBadge) bannerBadge.textContent = String(count);
    }

    openVersionHistoryModal(targetFile = "src/autons.cpp", selectVersionId = null) {
      const modal = document.getElementById("versionHistoryModal");
      if (!modal) return;

      const fileSelect = document.getElementById("versionFileSelect");
      if (fileSelect && this.project?.files) {
        fileSelect.innerHTML = "";
        const fileNames = Object.keys(this.project.files).sort();
        const sorted = ["src/autons.cpp", ...fileNames.filter(f => f !== "src/autons.cpp")];
        sorted.forEach(fname => {
          if (this.project.files[fname] !== undefined) {
            const opt = document.createElement("option");
            opt.value = fname;
            opt.textContent = fname + (fname === "src/autons.cpp" ? " (Autonomous Routines)" : "");
            if (fname === targetFile) opt.selected = true;
            fileSelect.appendChild(opt);
          }
        });
      }

      this._activeVersionFile = targetFile;
      this._selectedVersionId = selectVersionId;
      this._versionDiffActive = false;

      this.renderVersionHistoryList(targetFile);
      modal.hidden = false;
      modal.classList.add("open");
    }

    closeVersionHistoryModal() {
      const modal = document.getElementById("versionHistoryModal");
      if (modal) {
        modal.hidden = true;
        modal.classList.remove("open");
      }
    }

    renderVersionHistoryList(targetFile) {
      const list = this.getVersionHistory(targetFile);
      const container = document.getElementById("versionListContainer");
      const countBadge = document.getElementById("versionListCountBadge");
      const statsPill = document.getElementById("versionStatsPill");
      const currentCode = this.getFile(targetFile) || "";

      if (countBadge) countBadge.textContent = String(list.length);
      if (statsPill) statsPill.textContent = `${list.length} snapshot${list.length === 1 ? '' : 's'} for ${targetFile}`;

      if (!container) return;
      container.innerHTML = "";

      if (list.length === 0) {
        container.innerHTML = `
          <div style="padding:28px 16px;text-align:center;color:#64748b;font-size:0.85rem;">
            <div style="font-size:1.8rem;margin-bottom:8px;">📜</div>
            No versions saved for this file yet.<br/>
            Click <strong>+ Save Version</strong> to create your first checkpoint.
          </div>
        `;
        this.renderVersionPreview(null, currentCode);
        return;
      }

      if (!this._selectedVersionId || !list.some(v => v.id === this._selectedVersionId)) {
        this._selectedVersionId = list[0].id;
      }

      list.forEach((v) => {
        const isSelected = v.id === this._selectedVersionId;
        const isCurrent = v.content === currentCode;

        let sourceClass = "source-ide";
        let sourceIcon = "💻";
        let sourceName = "IDE C++";

        if (v.source === "before_blocks_sync") {
          sourceClass = "source-sync";
          sourceIcon = "🛡️";
          sourceName = "Pre-Sync Backup";
        } else if (v.source === "blocks_merge") {
          sourceClass = "source-merge";
          sourceIcon = "🔀";
          sourceName = "Blocks Overwrite";
        } else if (v.source === "blocks_append") {
          sourceClass = "source-merge";
          sourceIcon = "➕";
          sourceName = "Blocks Append";
        } else if (v.source === "restore") {
          sourceClass = "source-restore";
          sourceIcon = "⏮️";
          sourceName = "Restored Backup";
        } else if (v.source === "manual") {
          sourceClass = "source-manual";
          sourceIcon = "💾";
          sourceName = "Checkpoint";
        } else if (v.source === "initial") {
          sourceClass = "source-initial";
          sourceIcon = "🏁";
          sourceName = "Baseline";
        }

        const authorLine = (v.authorName || v.authorEmail)
          ? `<div style="font-size:0.7rem;color:#38bdf8;margin:3px 0;display:flex;align-items:center;gap:4px;">
               <span>👤</span>
               <span style="font-weight:600;">${String(v.authorName || v.authorEmail).replace(/</g, '&lt;')}</span>
               <span style="background:rgba(56,189,248,0.18);color:#7dd3fc;padding:1px 5px;border-radius:4px;font-size:0.62rem;font-weight:700;">${String(v.authorRole || 'Member').replace(/</g, '&lt;')}</span>
             </div>`
          : '';

        const card = document.createElement("div");
        card.className = `version-item-card ${isSelected ? 'selected' : ''} ${isCurrent ? 'current-active' : ''}`;
        card.innerHTML = `
          <div class="version-item-top">
            <span class="version-source-pill ${sourceClass}">${sourceIcon} ${sourceName}</span>
            <span class="version-date">${v.dateStr}</span>
          </div>
          <div class="version-item-label">${v.label || 'Saved Version'}</div>
          ${authorLine}
          <div class="version-item-footer">
            <span>${v.linesCount} lines · ${(v.sizeBytes / 1024).toFixed(1)} KB</span>
            ${isCurrent ? '<span class="version-active-tag">CURRENT ACTIVE</span>' : ''}
          </div>
        `;

        card.onclick = () => {
          this._selectedVersionId = v.id;
          this.renderVersionHistoryList(targetFile);
        };

        container.appendChild(card);
      });

      const selected = list.find(v => v.id === this._selectedVersionId) || list[0];
      this.renderVersionPreview(selected, currentCode);
    }

    renderVersionPreview(version, currentCode) {
      const titleEl = document.getElementById("versionPreviewTitle");
      const metaEl = document.getElementById("versionPreviewMeta");
      const codeView = document.getElementById("versionCodeView");
      const btnDiff = document.getElementById("btnToggleDiffView");
      const btnRestore = document.getElementById("btnRestoreVersionCode");
      const btnCopy = document.getElementById("btnCopyVersionCode");
      const btnDownload = document.getElementById("btnDownloadVersionCode");
      const btnDelete = document.getElementById("btnDeleteVersionSnapshot");

      if (!version) {
        if (titleEl) titleEl.textContent = "No Version Selected";
        if (metaEl) metaEl.textContent = "--";
        if (codeView) codeView.textContent = "// No version selected";
        if (btnRestore) btnRestore.disabled = true;
        if (btnCopy) btnCopy.disabled = true;
        if (btnDownload) btnDownload.disabled = true;
        if (btnDelete) btnDelete.disabled = true;
        return;
      }

      if (btnRestore) btnRestore.disabled = false;
      if (btnCopy) btnCopy.disabled = false;
      if (btnDownload) btnDownload.disabled = false;
      if (btnDelete) btnDelete.disabled = false;

      if (titleEl) titleEl.textContent = version.label || "Version Snapshot";
      if (metaEl) {
        const isCurrent = version.content === currentCode;
        metaEl.textContent = `${version.linesCount} lines · ${(version.sizeBytes / 1024).toFixed(1)} KB · ${version.dateStr}${isCurrent ? ' (Matching Active)' : ''}`;
      }

      if (btnDiff) {
        btnDiff.textContent = this._versionDiffActive ? "📄 Show Raw Code" : "🔍 Compare Diff";
      }

      if (!codeView) return;

      if (this._versionDiffActive) {
        const diff = this.diffLines(currentCode, version.content);
        let html = "";
        diff.forEach(item => {
          const esc = (item.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          if (item.type === "added_in_snapshot") {
            html += `<div class="diff-line diff-added" style="background:rgba(16,185,129,0.18);color:#6ee7b7;"><span class="diff-prefix">+</span> ${esc}</div>`;
          } else if (item.type === "removed_in_snapshot") {
            html += `<div class="diff-line diff-removed" style="background:rgba(239,68,68,0.18);color:#fca5a5;"><span class="diff-prefix">-</span> ${esc}</div>`;
          } else if (item.type === "changed_in_snapshot") {
            const origEsc = (item.origText || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            html += `<div class="diff-line diff-removed" style="background:rgba(239,68,68,0.18);color:#fca5a5;"><span class="diff-prefix">-</span> ${origEsc}</div>`;
            html += `<div class="diff-line diff-added" style="background:rgba(16,185,129,0.18);color:#6ee7b7;"><span class="diff-prefix">+</span> ${esc}</div>`;
          } else {
            html += `<div class="diff-line" style="color:#94a3b8;"><span class="diff-prefix" style="color:#475569;"> </span> ${esc}</div>`;
          }
        });
        codeView.innerHTML = html || `<div style="color:#64748b;">No code differences.</div>`;
      } else {
        codeView.textContent = version.content;
      }
    }

    wireVersionHistoryUI() {
      if (this._uiWired) return;
      this._uiWired = true;

      const modal = document.getElementById("versionHistoryModal");
      if (!modal) return;

      const btnClose = document.getElementById("btnVersionModalClose");
      const btnDone = document.getElementById("btnVersionModalDone");
      const fileSelect = document.getElementById("versionFileSelect");
      const btnCreate = document.getElementById("btnCreateCheckpoint");
      const inputLabel = document.getElementById("inputNewCheckpointLabel");
      const btnDiff = document.getElementById("btnToggleDiffView");
      const btnRestore = document.getElementById("btnRestoreVersionCode");
      const btnCopy = document.getElementById("btnCopyVersionCode");
      const btnDownload = document.getElementById("btnDownloadVersionCode");
      const btnDelete = document.getElementById("btnDeleteVersionSnapshot");

      const closeHandler = () => this.closeVersionHistoryModal();
      if (btnClose) btnClose.onclick = closeHandler;
      if (btnDone) btnDone.onclick = closeHandler;

      if (fileSelect) {
        fileSelect.onchange = () => {
          this._activeVersionFile = fileSelect.value;
          this._selectedVersionId = null;
          this.renderVersionHistoryList(this._activeVersionFile);
        };
      }

      if (btnCreate) {
        btnCreate.onclick = () => {
          const lbl = inputLabel ? inputLabel.value.trim() : "";
          const target = this._activeVersionFile || "src/autons.cpp";
          const snap = this.createVersionSnapshot(target, "manual", lbl || "Manual Checkpoint");
          if (inputLabel) inputLabel.value = "";
          if (snap) {
            this._selectedVersionId = snap.id;
            this.renderVersionHistoryList(target);
            if (typeof showToast === "function") {
              showToast(`✅ Created version checkpoint: "${snap.label}"`);
            }
          }
        };
      }

      if (btnDiff) {
        btnDiff.onclick = () => {
          this._versionDiffActive = !this._versionDiffActive;
          const currentCode = this.getFile(this._activeVersionFile || "src/autons.cpp") || "";
          const list = this.getVersionHistory(this._activeVersionFile || "src/autons.cpp");
          const selected = list.find(v => v.id === this._selectedVersionId);
          this.renderVersionPreview(selected, currentCode);
        };
      }

      if (btnCopy) {
        btnCopy.onclick = () => {
          const list = this.getVersionHistory(this._activeVersionFile || "src/autons.cpp");
          const selected = list.find(v => v.id === this._selectedVersionId);
          if (selected && selected.content) {
            navigator.clipboard.writeText(selected.content).then(() => {
              if (typeof showToast === "function") showToast("📋 Code copied to clipboard!");
            });
          }
        };
      }

      if (btnDownload) {
        btnDownload.onclick = () => {
          const list = this.getVersionHistory(this._activeVersionFile || "src/autons.cpp");
          const selected = list.find(v => v.id === this._selectedVersionId);
          if (selected && selected.content) {
            const fname = (this._activeVersionFile || "autons.cpp").split("/").pop();
            const blob = new Blob([selected.content], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `version_${selected.id}_${fname}`;
            a.click();
            URL.revokeObjectURL(url);
          }
        };
      }

      if (btnDelete) {
        btnDelete.onclick = () => {
          if (!this._selectedVersionId) return;
          if (confirm("Are you sure you want to delete this version snapshot?")) {
            this.deleteVersion(this._selectedVersionId, this._activeVersionFile || "src/autons.cpp");
            this._selectedVersionId = null;
            this.renderVersionHistoryList(this._activeVersionFile || "src/autons.cpp");
          }
        };
      }

      if (btnRestore) {
        btnRestore.onclick = () => {
          if (!this._selectedVersionId) return;
          const list = this.getVersionHistory(this._activeVersionFile || "src/autons.cpp");
          const selected = list.find(v => v.id === this._selectedVersionId);
          if (!selected) return;

          if (confirm(`Restore version "${selected.label}" (${selected.dateStr})?\n\nYour current code will be automatically backed up first.`)) {
            const restored = this.restoreVersion(selected.id, this._activeVersionFile || "src/autons.cpp");
            
            // If IDE editor active, update its textarea/editor
            if (typeof window.refreshIdeEditorIfActive === "function") {
              window.refreshIdeEditorIfActive(this._activeVersionFile || "src/autons.cpp");
            }

            // If in planner, update banner & reload paths safely
            if (typeof updateProjectBanner === "function") {
              updateProjectBanner();
            }
            if (typeof loadProjectAutonsIntoPlanner === "function") {
              loadProjectAutonsIntoPlanner(false, true);
            }

            this.closeVersionHistoryModal();
            if (typeof showToast === "function") {
              showToast(`✅ Restored version: "${restored.label}" (Previous code backed up)`);
            }
          }
        };
      }
    }


    deleteFile(filename) {
      if (this.project?.files?.[filename]) {
        delete this.project.files[filename];
        if (this.versions && this.versions[filename]) {
          delete this.versions[filename];
          try { idbPut("file_versions_history", this.versions); } catch (_) {}
        }
        this.indexVariables();
        this.markDirty(true);
        this.saveLocal();
        this.notifyListeners("file_deleted");
      }
    }

    renameFile(oldName, newName) {
      if (this.project?.files?.[oldName]) {
        const content = this.project.files[oldName];
        delete this.project.files[oldName];
        this.project.files[newName] = content;
        this.markDirty(true);
        this.saveLocal();
      }
    }

    // -------------------------------------------------------------
    // Variable & Device Indexer (Scans all project headers/scripts)
    // -------------------------------------------------------------
    indexVariables() {
      if (!this.project || !this.project.files) {
        this.symbols = { motors: [], pistons: [], sensors: [], chassis: [], functions: [], constants: [] };
        return this.symbols;
      }

      const isIgnoredSymbol = (name) => {
        if (!name || typeof name !== "string") return true;
        const l = name.toLowerCase();
        return l.startsWith("lv_") || l.startsWith("_lv_") || l.startsWith("lvgl");
      };

      const symbols = {
        motors: [],
        pistons: [],
        sensors: [],
        chassis: [],
        functions: [],
        constants: [],
      };

      const allFiles = Object.entries(this.project.files);

      allFiles.forEach(([fileName, content]) => {
        if (!content || typeof content !== "string") return;
        const lines = content.split("\n");

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

          // 1. Motors & MotorGroups (PROS + VEXcode)
          const motorMatch = trimmed.match(/(?:extern\s+)?(?:pros::(?:v5::)?Motor|vex::motor|motor)\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]*)\))?/);
          if (motorMatch && motorMatch[1] && !motorMatch[1].includes("Group") && !motorMatch[1].includes("group") && !["left_front", "right_front", "Left1", "Right1"].includes(motorMatch[1])) {
            const name = motorMatch[1];
            const args = motorMatch[2] || "";
            const isVex = trimmed.includes("vex::") || /\bPORT\d+/i.test(args) || /\bratio\d+/i.test(args) || /\bmotor\b/.test(trimmed);
            if (!isIgnoredSymbol(name) && !symbols.motors.some(m => m.name === name)) {
              symbols.motors.push({
                name,
                type: isVex ? "vex::motor" : "pros::Motor",
                args,
                file: fileName,
                line: lineIdx + 1,
                snippet: isVex ? `${name}.spin(fwd, 12, volt);` : `${name}.move(127);`,
                stopSnippet: isVex ? `${name}.stop();` : `${name}.move(0);`,
              });
            }
          }

          // MotorGroups (PROS + VEXcode)
          const groupMatch = trimmed.match(/(?:extern\s+)?(?:pros::(?:v5::)?MotorGroup|vex::motor_group|motor_group)\s+([a-zA-Z0-9_]+)/);
          if (groupMatch && groupMatch[1]) {
            const name = groupMatch[1];
            const isVex = trimmed.includes("vex::") || trimmed.includes("motor_group");
            if (!isIgnoredSymbol(name) && !symbols.motors.some(m => m.name === name)) {
              symbols.motors.push({
                name,
                type: isVex ? "vex::motor_group" : "pros::MotorGroup",
                file: fileName,
                line: lineIdx + 1,
                snippet: isVex ? `${name}.spin(fwd, 12, volt);` : `${name}.move(127);`,
                stopSnippet: isVex ? `${name}.stop();` : `${name}.move(0);`,
              });
            }
          }

          // 2. Pneumatics / ADI DigitalOut (PROS + VEXcode)
          const pistonMatch = trimmed.match(/(?:extern\s+)?(?:(?:pros::)?(?:adi::)?(?:DigitalOut|ADIDigitalOut)|(?:vex::)?(?:digital_out|pneumatics))\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]*)\))?/);
          if (pistonMatch && pistonMatch[1]) {
            const name = pistonMatch[1];
            const port = pistonMatch[2] || "Port";
            const isVex = trimmed.includes("vex::") || trimmed.includes("digital_out") || trimmed.includes("pneumatics");
            if (!isIgnoredSymbol(name) && !symbols.pistons.some(p => p.name === name)) {
              symbols.pistons.push({
                name,
                type: isVex ? "vex::digital_out" : "pros::adi::DigitalOut",
                port,
                file: fileName,
                line: lineIdx + 1,
                snippet: isVex ? `${name}.set(true);` : `${name}.set_value(true);`,
                releaseSnippet: isVex ? `${name}.set(false);` : `${name}.set_value(false);`,
              });
            }
          }

          // 3. Sensors (PROS + VEXcode IMU, Rotation, Distance, GPS, Optical)
          const sensorMatch = trimmed.match(/(?:extern\s+)?(?:(?:pros::)?(Imu|Rotation|Distance|GPS|Optical)|(?:vex::)?(inertial|rotation|distance|gps|optical))\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]*)\))?/);
          if (sensorMatch && sensorMatch[3]) {
            const rawType = sensorMatch[1] || sensorMatch[2];
            const isVex = Boolean(sensorMatch[2]);
            const name = sensorMatch[3];
            const args = sensorMatch[4] || "";
            if (!isIgnoredSymbol(name) && !symbols.sensors.some(s => s.name === name)) {
              symbols.sensors.push({
                name,
                type: isVex ? `vex::${rawType}` : `pros::${rawType}`,
                args,
                file: fileName,
                line: lineIdx + 1,
                snippet: isVex ? `${name}.rotation(degrees);` : `${name}.get_value();`,
              });
            }
          }

          // 4. Chassis (LemLib, EZ-Template, JAR-Template)
          const chassisMatch = trimmed.match(/(?:extern\s+)?(?:(lemlib::Chassis|ez::Drive|Drive))\s+([a-zA-Z0-9_]+)/);
          if (chassisMatch && chassisMatch[2]) {
            const cType = chassisMatch[1];
            const name = chassisMatch[2];
            if (!isIgnoredSymbol(name) && !symbols.chassis.some(c => c.name === name)) {
              symbols.chassis.push({
                name,
                type: cType.includes("::") ? cType : (cType === "Drive" ? "Drive" : "lemlib::Chassis"),
                file: fileName,
                line: lineIdx + 1,
              });
            }
          }

          // 5. Functions & Subsystem Helpers
          // e.g. void setIntake(int speed); or void driveTo(double x, double y, double theta)
          const fnMatch = trimmed.match(/(?:void|int|bool|double|float)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:\{|;)/);
          if (fnMatch && fnMatch[1]) {
            const fnName = fnMatch[1];
            const params = fnMatch[2];
            if (!isIgnoredSymbol(fnName) && !["initialize", "disabled", "competition_initialize", "autonomous", "opcontrol"].includes(fnName)) {
              if (!symbols.functions.some(f => f.name === fnName)) {
                const paramParts = params.trim() && params.trim() !== "void" ? params.split(",").map(p => p.trim()).filter(Boolean) : [];
                let defaultSnippet = `${fnName}();`;
                if (paramParts.length === 1) defaultSnippet = `${fnName}(127);`;
                else if (paramParts.length === 2) defaultSnippet = `${fnName}(24, 24);`;
                else if (paramParts.length >= 3) defaultSnippet = `${fnName}(24, 36, 90);`;
                symbols.functions.push({
                  name: fnName,
                  signature: `${fnName}(${params})`,
                  file: fileName,
                  line: lineIdx + 1,
                  paramCount: paramParts.length,
                  snippet: defaultSnippet,
                });
              }
            }
          }
        });
      });

      if (typeof window !== "undefined" && window.CppTranslator && typeof window.CppTranslator.extractCustomFunctions === "function") {
        try {
          window.CppTranslator.extractCustomFunctions("", this.project.files);
        } catch (_) {}
      }

      this.symbols = symbols;
      this.extractLemLibConfig();
      return symbols;
    }

    // -------------------------------------------------------------
    // LemLib Omniwheel & Dimension Helper
    // -------------------------------------------------------------
    resolveWheelDiameter(raw) {
      if (!raw) return 3.25;
      const str = String(raw).trim();
      if (str.includes("NEW_2") && !str.includes("NEW_275")) return 2.0;
      if (str.includes("OLD_275") || str.includes("NEW_275")) return 2.75;
      if (str.includes("OLD_325") || str.includes("NEW_325")) return 3.25;
      if (str.includes("OLD_4") || str.includes("NEW_4")) return 4.0;
      const num = parseFloat(str.replace(/[^0-9.]/g, ""));
      return isNaN(num) || num <= 0 ? 3.25 : num;
    }

    // -------------------------------------------------------------
    // Extract LemLib Drivetrain, PID Controllers & Sensors from C++
    // -------------------------------------------------------------
    extractLemLibConfig() {
      if (!this.project || !this.project.files) return null;
      const config = {
        drivetrain: {
          trackWidth: 12.0,
          wheelDiam: 3.25,
          driveRpm: 600,
          horizontalDrift: 2.0,
        },
        lateralController: {
          kp: 8.0,
          ki: 0.0,
          kd: 30.0,
          windup: 3.0,
          smallErr: 1.0,
          smallTime: 100,
          largeErr: 3.0,
          largeTime: 500,
          slew: 0,
        },
        angularController: {
          kp: 2.0,
          ki: 0.0,
          kd: 10.0,
          windup: 3.0,
          smallErr: 1.0,
          smallTime: 100,
          largeErr: 3.0,
          largeTime: 500,
          slew: 0,
        },
        trackingWheels: {
          horiz: { name: "horiz_wheel", offset: -2.5, wheelDiam: 2.0, port: 9 },
          vert: { name: "vert_wheel", offset: 0, wheelDiam: 2.75, port: null },
        },
        sensors: {
          imuPort: 10,
          distPort: 15,
        },
        motors: {
          leftPorts: [1, 2, 3],
          rightPorts: [-11, -12, -13],
          gearset: "blue",
        },
        sourceFile: "src/robot-config.cpp",
      };

      const files = this.project.files;
      const allText = Object.entries(files).map(([k, v]) => `// File: ${k}\n${v}`).join("\n\n");

      // 1. Drivetrain
      const dtMatch = allText.match(/(?:extern\s+)?(?:lemlib::)?Drivetrain\s+([a-zA-Z0-9_]+)\s*\(([^;]+)\);/);
      if (dtMatch && dtMatch[2]) {
        const args = dtMatch[2].split(",").map(a => a.trim().replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/gm, "").trim());
        if (args.length >= 3) {
          const tw = parseFloat(args[2]);
          if (!isNaN(tw) && tw > 0) config.drivetrain.trackWidth = tw;
        }
        if (args.length >= 4) {
          config.drivetrain.wheelDiam = this.resolveWheelDiameter(args[3]);
        }
        if (args.length >= 5) {
          const rpm = parseFloat(args[4]);
          if (!isNaN(rpm) && rpm > 0) config.drivetrain.driveRpm = rpm;
        }
        if (args.length >= 6) {
          const drift = parseFloat(args[5]);
          if (!isNaN(drift) && drift > 0) config.drivetrain.horizontalDrift = drift;
        }
      }

      // 2. Lateral Controller
      const latMatch = allText.match(/(?:extern\s+)?(?:lemlib::)?ControllerSettings\s+(?:lateral_controller|lateralController|lateral_pid|[a-zA-Z0-9_]*lat[a-zA-Z0-9_]*)\s*\(([^;]+)\);/i);
      if (latMatch && latMatch[1]) {
        const args = latMatch[1].split(",").map(a => parseFloat(a.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/gm, "").trim()));
        if (!isNaN(args[0])) config.lateralController.kp = args[0];
        if (!isNaN(args[1])) config.lateralController.ki = args[1];
        if (!isNaN(args[2])) config.lateralController.kd = args[2];
        if (!isNaN(args[3])) config.lateralController.windup = args[3];
        if (!isNaN(args[4])) config.lateralController.smallErr = args[4];
        if (!isNaN(args[5])) config.lateralController.smallTime = args[5];
        if (!isNaN(args[6])) config.lateralController.largeErr = args[6];
        if (!isNaN(args[7])) config.lateralController.largeTime = args[7];
        if (!isNaN(args[8])) config.lateralController.slew = args[8];
      }

      // 3. Angular Controller
      const angMatch = allText.match(/(?:extern\s+)?(?:lemlib::)?ControllerSettings\s+(?:angular_controller|angularController|angular_pid|[a-zA-Z0-9_]*ang[a-zA-Z0-9_]*)\s*\(([^;]+)\);/i);
      if (angMatch && angMatch[1]) {
        const args = angMatch[1].split(",").map(a => parseFloat(a.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/gm, "").trim()));
        if (!isNaN(args[0])) config.angularController.kp = args[0];
        if (!isNaN(args[1])) config.angularController.ki = args[1];
        if (!isNaN(args[2])) config.angularController.kd = args[2];
        if (!isNaN(args[3])) config.angularController.windup = args[3];
        if (!isNaN(args[4])) config.angularController.smallErr = args[4];
        if (!isNaN(args[5])) config.angularController.smallTime = args[5];
        if (!isNaN(args[6])) config.angularController.largeErr = args[6];
        if (!isNaN(args[7])) config.angularController.largeTime = args[7];
        if (!isNaN(args[8])) config.angularController.slew = args[8];
      }

      // 4. Tracking Wheels
      const twRegex = /(?:extern\s+)?(?:lemlib::)?TrackingWheel\s+([a-zA-Z0-9_]+)\s*\(([^;]+)\);/g;
      let twMatch;
      while ((twMatch = twRegex.exec(allText)) !== null) {
        const name = twMatch[1];
        const args = twMatch[2].split(",").map(a => a.trim());
        const diam = args[1] ? this.resolveWheelDiameter(args[1]) : 2.0;
        const offset = args[2] ? parseFloat(args[2]) : 0;
        if (name.toLowerCase().includes("horiz") || name.toLowerCase().includes("drift")) {
          config.trackingWheels.horiz = { name, offset: isNaN(offset) ? -2.5 : offset, wheelDiam: diam };
        } else if (name.toLowerCase().includes("vert") || name.toLowerCase().includes("fwd")) {
          config.trackingWheels.vert = { name, offset: isNaN(offset) ? 0 : offset, wheelDiam: diam };
        }
      }

      // 5. Sensors (IMU)
      const imuMatch = allText.match(/(?:pros::)?Imu\s+([a-zA-Z0-9_]+)\s*\(\s*([0-9]+)\s*\)/);
      if (imuMatch && imuMatch[2]) {
        config.sensors.imuPort = parseInt(imuMatch[2], 10);
      }

      this.lemlibConfig = config;
      return config;
    }

    // -------------------------------------------------------------
    // Update src/robot-config.cpp with UI Bot Settings & Dimensions
    // -------------------------------------------------------------
    updateRobotConfigCpp(bot) {
      if (!this.project) this.initDefaultProject();
      const lib = normalizeLibId(bot?.library || this.getProjectLibrary());
      const trackWidth = Number(bot.trackWidth || 12).toFixed(1);
      const wheelDiam = Number(bot.wheelDiam || 3.25).toFixed(2);
      const driveRpm = Math.round(bot.driveRpm || 600);
      const imuPort = bot.imuPort || 10;
      const horizPort = bot.horizTrackerPort || 9;
      const horizOffset = Number(bot.horizTrackerOffset != null ? bot.horizTrackerOffset : -2.5).toFixed(1);
      const latKp = Number(bot.lateralKp != null ? bot.lateralKp : 8.0).toFixed(2);
      const latKi = Number(bot.lateralKi != null ? bot.lateralKi : 0.0).toFixed(3);
      const latKd = Number(bot.lateralKd != null ? bot.lateralKd : 30.0).toFixed(2);
      const angKp = Number(bot.angularKp != null ? bot.angularKp : 2.0).toFixed(2);
      const angKi = Number(bot.angularKi != null ? bot.angularKi : 0.0).toFixed(3);
      const angKd = Number(bot.angularKd != null ? bot.angularKd : 10.0).toFixed(2);

      if (lib === "ez_template") {
        const ezConfigCpp = `// =================================================================
// robot-config.cpp - EZ-Template Drive & PID Constants Setup
// Synchronized with Path Planner & PID Tuner
// =================================================================
#include "main.h"
#include "robot-config.h"

pros::Motor intake(7, pros::v5::MotorGears::blue);
pros::Motor lift(8, pros::v5::MotorGears::green);
pros::adi::DigitalOut clamp('A', false);
pros::adi::DigitalOut doinker('B', false);

ez::Drive chassis(
    {1, 2, 3},      // Left Motors
    {-11, -12, -13}, // Right Motors
    ${imuPort},      // IMU Port
    ${wheelDiam},    // Wheel Diameter (in)
    ${driveRpm}      // Wheel RPM
);

void default_constants() {
    chassis.pid_drive_constants_set(${latKp}, ${latKi}, ${latKd});
    chassis.pid_heading_constants_set(11.0, 0.0, 20.0);
    chassis.pid_turn_constants_set(${angKp}, ${angKi}, ${angKd}, 15.0);
    chassis.pid_swing_constants_set(6.0, 0.0, 65.0);

    chassis.pid_drive_exit_condition_set(90_ms, 1_in, 250_ms, 3_in, 500_ms, 500_ms);
    chassis.pid_turn_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 500_ms);
    chassis.pid_swing_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 500_ms);
}
`;
        this.setFile("src/robot-config.cpp", ezConfigCpp);
        return ezConfigCpp;
      }

      if (lib === "rw_template") {
        const rwConfigCpp = `// =================================================================
// robot-config.cpp - RW-Template Motors, Sensors & PID Constants
// Synchronized with Path Planner & PID Tuner
// =================================================================
#include "vex.h"
#include "robot-config.h"

vex::brain Brain;
vex::controller Controller1(vex::controllerType::primary);

vex::motor left_front(vex::PORT1, vex::ratio6_1, false);
vex::motor left_middle(vex::PORT2, vex::ratio6_1, false);
vex::motor left_back(vex::PORT3, vex::ratio6_1, false);
vex::motor right_front(vex::PORT11, vex::ratio6_1, true);
vex::motor right_middle(vex::PORT12, vex::ratio6_1, true);
vex::motor right_back(vex::PORT13, vex::ratio6_1, true);

vex::motor_group left_motors(left_front, left_middle, left_back);
vex::motor_group right_motors(right_front, right_middle, right_back);

vex::motor intake(vex::PORT7, vex::ratio6_1, false);
vex::motor lift(vex::PORT8, vex::ratio18_1, false);
vex::digital_out clamp(Brain.ThreeWirePort.A);
vex::inertial Inertial(vex::PORT${imuPort});

double wheel_diam = ${wheelDiam};
double drive_rpm = ${driveRpm}.0;
double track_width = ${trackWidth};
double lateral_kp = ${latKp}, lateral_ki = ${latKi}, lateral_kd = ${latKd};
double angular_kp = ${angKp}, angular_ki = ${angKi}, angular_kd = ${angKd};
`;
        this.setFile("src/robot-config.cpp", rwConfigCpp);
        return rwConfigCpp;
      }

      if (lib === "jar_template") {
        const jarConfigCpp = `// =================================================================
// robot-config.cpp - JAR-Template Drivetrain & PID Configuration
// Synchronized with Path Planner & PID Tuner
// =================================================================
#include "vex.h"
#include "robot-config.h"

vex::brain Brain;
vex::controller Controller1(vex::controllerType::primary);

vex::motor Left1(vex::PORT1, vex::ratio6_1, true);
vex::motor Left2(vex::PORT2, vex::ratio6_1, true);
vex::motor Left3(vex::PORT3, vex::ratio6_1, true);
vex::motor Right1(vex::PORT11, vex::ratio6_1, false);
vex::motor Right2(vex::PORT12, vex::ratio6_1, false);
vex::motor Right3(vex::PORT13, vex::ratio6_1, false);

vex::motor_group LeftDrive(Left1, Left2, Left3);
vex::motor_group RightDrive(Right1, Right2, Right3);
vex::motor intake(vex::PORT7, vex::ratio6_1, false);
vex::motor lift(vex::PORT8, vex::ratio18_1, false);
vex::digital_out clamp(Brain.ThreeWirePort.A);
vex::inertial Inertial(vex::PORT${imuPort});

Drive chassis(
    ZERO_TRACKER_NO_ODOM,
    LeftDrive,
    RightDrive,
    vex::PORT${imuPort},
    ${wheelDiam}, // wheel diameter (in)
    1.0,          // external gear ratio
    360,          // gyro scale
    vex::PORT1,
    vex::PORT2,
    vex::PORT3,
    vex::PORT11,
    ${trackWidth}, // drive width (in)
    ${horizOffset} // tracker offset (in)
);

void default_constants() {
    chassis.set_drive_constants(10, ${latKp}, ${latKi}, ${latKd}, 0);
    chassis.set_heading_constants(6, .4, 0, 1, 0);
    chassis.set_turn_constants(12, ${angKp}, ${angKi}, ${angKd}, 15);
    chassis.set_swing_constants(12, .3, .001, 2, 15);
}
`;
        this.setFile("src/robot-config.cpp", jarConfigCpp);
        return jarConfigCpp;
      }

      const wheelEnum = (diam) => {
        if (Math.abs(diam - 2.0) < 0.1) return "lemlib::Omniwheel::NEW_2";
        if (Math.abs(diam - 2.75) < 0.1) return "lemlib::Omniwheel::NEW_275";
        if (Math.abs(diam - 3.25) < 0.1) return "lemlib::Omniwheel::NEW_325";
        if (Math.abs(diam - 4.0) < 0.1) return "lemlib::Omniwheel::NEW_4";
        return `${Number(diam).toFixed(2)}`;
      };

      const wheelDiamEnum = wheelEnum(bot.wheelDiam || 3.25);
      const driveRpmFloat = Number(bot.driveRpm || 600).toFixed(1);
      const driftScaler = Number(bot.lateralDrift || 2.0).toFixed(1);

      const latWindup = Number(bot.lateralWindup != null ? bot.lateralWindup : 3.0).toFixed(1);
      const latSmallErr = Number(bot.lateralSmallErr != null ? bot.lateralSmallErr : 1.0).toFixed(1);
      const latSmallTime = Math.round(bot.lateralSmallTime != null ? bot.lateralSmallTime : 100);
      const latLargeErr = Number(bot.lateralLargeErr != null ? bot.lateralLargeErr : 3.0).toFixed(1);
      const latLargeTime = Math.round(bot.lateralLargeTime != null ? bot.lateralLargeTime : 500);
      const latSlew = Math.round(bot.lateralSlew != null ? bot.lateralSlew : 0);

      const angWindup = Number(bot.angularWindup != null ? bot.angularWindup : 3.0).toFixed(1);
      const angSmallErr = Number(bot.angularSmallErr != null ? bot.angularSmallErr : 1.0).toFixed(1);
      const angSmallTime = Math.round(bot.angularSmallTime != null ? bot.angularSmallTime : 100);
      const angLargeErr = Number(bot.angularLargeErr != null ? bot.angularLargeErr : 3.0).toFixed(1);
      const angLargeTime = Math.round(bot.angularLargeTime != null ? bot.angularLargeTime : 500);
      const angSlew = Math.round(bot.angularSlew != null ? bot.angularSlew : 0);

      const horizWheelEnum = wheelEnum(bot.horizTrackerWheelDiam != null ? bot.horizTrackerWheelDiam : 2.0);

      const newConfigCpp = `// =================================================================
// robot-config.cpp - Hardware Port Definitions & Controller Setup
// Synchronized with LemLib Autonomous Planner & PID Tuner
// =================================================================
#include "main.h"
#include "robot-config.h"

// Drivetrain 6-Motor Setup (${driveRpmFloat} RPM)
pros::Motor left_front(1, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor left_middle(2, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor left_back(3, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);

pros::Motor right_front(-11, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor right_middle(-12, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);
pros::Motor right_back(-13, pros::v5::MotorGears::blue, pros::v5::MotorUnits::degrees);

pros::MotorGroup left_motors({left_front, left_middle, left_back});
pros::MotorGroup right_motors({right_front, right_middle, right_back});

// Subsystems
pros::Motor intake(7, pros::v5::MotorGears::blue);
pros::Motor lift(8, pros::v5::MotorGears::green);
pros::adi::DigitalOut clamp('A', false);
pros::adi::DigitalOut doinker('B', false);
pros::adi::DigitalOut intake_lift('C', false);

// Sensors
pros::Imu imu(${imuPort});
pros::Rotation horiz_tracker(${horizPort});
pros::Distance dist_sensor(15);

// Tracking Wheel Setup
lemlib::TrackingWheel horiz_wheel(&horiz_tracker, ${horizWheelEnum}, ${horizOffset});

// LemLib Drivetrain Configuration (${trackWidth}" Track Width, ${bot.wheelDiam || 3.25}" Wheels, ${driveRpmFloat} RPM)
lemlib::Drivetrain drivetrain(
    &left_motors,
    &right_motors,
    ${trackWidth}, // track width (inches)
    ${wheelDiamEnum}, // wheel diameter
    ${driveRpmFloat}, // drivetrain RPM
    ${driftScaler} // horizontal drift scaler
);

// Lateral PID Controller
lemlib::ControllerSettings lateral_controller(
    ${latKp}, // kP
    ${latKi}, // kI
    ${latKd}, // kD
    ${latWindup}, // anti-windup range
    ${latSmallErr}, // small error range (in)
    ${latSmallTime}, // small error timeout (ms)
    ${latLargeErr}, // large error range (in)
    ${latLargeTime}, // large error timeout (ms)
    ${latSlew} // slew rate
);

// Angular PID Controller
lemlib::ControllerSettings angular_controller(
    ${angKp}, // kP
    ${angKi}, // kI
    ${angKd}, // kD
    ${angWindup}, // anti-windup range
    ${angSmallErr}, // small error range (deg)
    ${angSmallTime}, // small error timeout (ms)
    ${angLargeErr}, // large error range (deg)
    ${angLargeTime}, // large error timeout (ms)
    ${angSlew} // slew rate
);

// Odometry Sensors
lemlib::OdomSensors sensors(
    nullptr, // vertical tracking wheel 1
    nullptr, // vertical tracking wheel 2
    &horiz_wheel, // horizontal tracking wheel
    nullptr, // horizontal tracking wheel 2
    &imu // inertial sensor
);

// LemLib Chassis Object
lemlib::Chassis chassis(drivetrain, lateral_controller, angular_controller, sensors);
`;

      this.setFile("src/robot-config.cpp", newConfigCpp);
      return newConfigCpp;
    }

    // -------------------------------------------------------------
    // Extract Autonomous Routines from src/autons.cpp
    // -------------------------------------------------------------
    getAutonRoutines() {
      const code = this.getFile("src/autons.cpp") || this.getFile("autons.cpp");
      if (!code || !code.trim()) return [{ name: "autonomous", body: "" }];

      const allFunctions = [];
      const fnHeaderRegex = /void\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{/g;
      let match;

      while ((match = fnHeaderRegex.exec(code)) !== null) {
        const name = match[1];
        const paramsRaw = (match[2] || "").trim();
        const hasParams = paramsRaw.length > 0 && paramsRaw !== "void";
        const startBodyIdx = fnHeaderRegex.lastIndex;
        
        let depth = 1;
        let endBodyIdx = startBodyIdx;
        let inString = false;
        let strQuote = "";
        let inSingleLineComment = false;
        let inMultiLineComment = false;

        for (let i = startBodyIdx; i < code.length; i++) {
          const char = code[i];
          const prevChar = i > startBodyIdx ? code[i - 1] : "";
          const nextChar = i < code.length - 1 ? code[i + 1] : "";

          if (inSingleLineComment) {
            if (char === "\n") inSingleLineComment = false;
            continue;
          }
          if (inMultiLineComment) {
            if (char === "/" && prevChar === "*") inMultiLineComment = false;
            continue;
          }
          if (inString) {
            if (char === strQuote && prevChar !== "\\") inString = false;
            continue;
          }

          if (char === "/" && nextChar === "/") {
            inSingleLineComment = true;
            i++;
            continue;
          }
          if (char === "/" && nextChar === "*") {
            inMultiLineComment = true;
            i++;
            continue;
          }
          if (char === '"' || char === "'") {
            inString = true;
            strQuote = char;
            continue;
          }

          if (char === "{") {
            depth++;
          } else if (char === "}") {
            depth--;
            if (depth === 0) {
              endBodyIdx = i;
              fnHeaderRegex.lastIndex = i + 1;
              break;
            }
          }
        }

        const body = code.substring(startBodyIdx, endBodyIdx);
        allFunctions.push({ name, paramsRaw, hasParams, body });
      }

      // If there are 0-parameter autonomous routines, exclude parameterized helper functions
      // (e.g. void driveTo(double x, double y, double theta)) from routine tabs so they act as helpers
      const zeroParamRoutines = allFunctions.filter((fn) => !fn.hasParams);
      const routines = (zeroParamRoutines.length > 0 ? zeroParamRoutines : allFunctions).map((fn) => ({
        name: fn.name,
        body: fn.body,
      }));

      if (routines.length === 0) {
        routines.push({
          name: "autonomous",
          body: code,
        });
      }
      return routines;
    }

    // Generate C++ code string from visual planner paths
    fallbackEmitRoutineBody(pose0, acts, indent = "    ", library = null) {
      const lib = normalizeLibId(library || this.getProjectLibrary());
      const f = (v) => {
        const n = Number(v || 0);
        return Number.isInteger(n) ? `${n}.0` : Number(n.toFixed(1)).toString();
      };
      const speedToVolts = (spd) => {
        const s = Math.max(0, Math.min(127, Number(spd != null ? spd : 127)));
        return Number(((s / 127) * 12).toFixed(1));
      };
      let code = "";
      if (pose0) {
        if (lib === "ez_template") {
          code += `${indent}chassis.odom_xyt_set(${f(pose0.x)}_in, ${f(pose0.y)}_in, ${f(pose0.theta)}_deg);\n`;
        } else if (lib === "rw_template") {
          code += `${indent}setOdom(${f(pose0.x)}, ${f(pose0.y)}, ${f(pose0.theta)});\n`;
        } else if (lib === "jar_template") {
          code += `${indent}chassis.set_coordinates(${f(pose0.x)}, ${f(pose0.y)}, ${f(pose0.theta)});\n`;
        } else {
          code += `${indent}chassis.setPose(${f(pose0.x)}, ${f(pose0.y)}, ${f(pose0.theta)});\n`;
        }
      }

      const list = acts || [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const nextAct = i < list.length - 1 ? list[i + 1] : null;
        const label = (a.label || "").trim();
        const cleanComment = label ? label.replace(/^\/\/\s*/, "") : "";
        if (a.type === "custom") {
          if (cleanComment) code += `${indent}// ${cleanComment}\n`;
          const lines = (a.customCode || "").split("\n");
          for (const line of lines) {
            if (line.trim().length === 0) code += "\n";
            else code += `${indent}${line}\n`;
          }
          continue;
        }
        if (a.type === "wait") {
          if (cleanComment) code += `${indent}// ${cleanComment}\n`;
          if (lib === "ez_template") {
            if (a.waitType === "distance" || a.waitType === "until") {
              code += `${indent}chassis.pid_wait_until(${a.distance != null ? a.distance : (a.waitDist != null ? a.waitDist : 12)}_in);\n`;
            } else if (a.waitType === "time") {
              code += `${indent}pros::delay(${a.delayMs != null ? a.delayMs : (a.timeout != null ? a.timeout : 250)});\n`;
            } else {
              code += `${indent}chassis.pid_wait();\n`;
            }
          } else if (lib === "rw_template" || lib === "jar_template") {
            if (a.waitType === "time") {
              code += `${indent}wait(${a.delayMs != null ? a.delayMs : (a.timeout != null ? a.timeout : 250)}, msec);\n`;
            } else if (a.waitType === "distance" || a.waitType === "until") {
              code += `${indent}// Distance trigger @ ${a.distance != null ? a.distance : 12}"\n`;
              code += `${indent}wait(150, msec);\n`;
            }
          } else {
            if (a.waitType === "distance" || a.waitType === "until") {
              code += `${indent}chassis.waitUntil(${a.distance != null ? a.distance : (a.waitDist != null ? a.waitDist : 12)});\n`;
            } else if (a.waitType === "done") {
              code += `${indent}chassis.waitUntilDone();\n`;
            } else if (a.waitType === "time") {
              code += `${indent}pros::delay(${a.delayMs != null ? a.delayMs : (a.timeout != null ? a.timeout : 250)});\n`;
            } else {
              code += `${indent}chassis.waitUntilDone();\n`;
            }
          }
          if (a.customCode && a.customCode.trim()) {
            const lines = a.customCode.trim().split("\n");
            for (const line of lines) {
              if (line.trim().length === 0) code += "\n";
              else code += `${indent}${line}\n`;
            }
          }
          continue;
        }
        const px = f((a.x || 0) + (a.offsetX || 0));
        const py = f((a.y || 0) + (a.offsetY || 0));
        const pt = f((a.theta || 0) + (a.offsetTheta || 0));
        const inlineComment = cleanComment ? ` // ${cleanComment}` : "";
        const spd = a.maxSpeed != null ? Math.round(a.maxSpeed) : 110;
        const dirEnum = a.forwards === false ? "ez::rev" : "ez::fwd";
        const dirInt = a.forwards === false ? -1 : 1;
        const nextIsWait = nextAct && nextAct.type === "wait" && (nextAct.waitType === "distance" || nextAct.waitType === "until" || nextAct.waitType === "done");

        if (lib === "ez_template") {
          switch (a.type) {
            case "moveToPoint":
              code += `${indent}chassis.pid_odom_set({{${px}_in, ${py}_in}, ${dirEnum}, ${spd}});${inlineComment}\n`;
              break;
            case "moveToPose":
            case "bezierCurve":
              code += `${indent}chassis.pid_odom_set({{${px}_in, ${py}_in, ${pt}_deg}, ${dirEnum}, ${spd}});${inlineComment}\n`;
              break;
            case "turnToPoint":
              code += `${indent}chassis.pid_turn_set({${px}_in, ${py}_in}, ${dirEnum}, ${a.maxSpeed != null ? spd : 90});${inlineComment}\n`;
              break;
            case "turnToHeading":
              code += `${indent}chassis.pid_turn_set(${pt}_deg, ${a.maxSpeed != null ? spd : 90});${inlineComment}\n`;
              break;
            case "swingToPoint":
            case "swingToHeading":
              code += `${indent}chassis.pid_swing_set(ez::${a.lockedSide === "RIGHT" ? "RIGHT_SWING" : "LEFT_SWING"}, ${pt}_deg, ${spd});${inlineComment}\n`;
              break;
          }
          if (!a.async && !nextIsWait) {
            code += (a.earlyExitRange && a.earlyExitRange > 0)
              ? `${indent}chassis.pid_wait_quick_chain();\n`
              : `${indent}chassis.pid_wait();\n`;
          }
          continue;
        }

        if (lib === "rw_template") {
          const maxV = a.maxSpeed != null && Number(a.maxSpeed) < 127 ? `, ${a.earlyExitRange || 0.5}, ${speedToVolts(a.maxSpeed)}` : "";
          switch (a.type) {
            case "moveToPoint":
              code += `${indent}moveToPoint(${px}, ${py}, ${dirInt}, ${a.timeout || 2000}${maxV});${inlineComment}\n`;
              break;
            case "moveToPose":
            case "bezierCurve":
              code += `${indent}moveToPoint(${px}, ${py}, ${dirInt}, ${a.timeout || 2500}${maxV});${inlineComment}\n`;
              code += `${indent}turnToAngle(${pt}, 1000);\n`;
              break;
            case "turnToPoint":
              code += `${indent}turnToPoint(${px}, ${py}, ${dirInt}, ${a.timeout || 1500});${inlineComment}\n`;
              break;
            case "turnToHeading":
              code += `${indent}turnToAngle(${pt}, ${a.timeout || 1500});${inlineComment}\n`;
              break;
            case "swingToPoint":
            case "swingToHeading":
              code += `${indent}swing(${pt}, ${a.lockedSide === "RIGHT" ? -1 : 1}, ${a.timeout || 1800});${inlineComment}\n`;
              break;
          }
          continue;
        }

        if (lib === "jar_template") {
          const vCap = speedToVolts(a.maxSpeed);
          const hasVolts = a.maxSpeed != null && Number(a.maxSpeed) < 127;
          switch (a.type) {
            case "moveToPoint":
              code += hasVolts
                ? `${indent}chassis.drive_to_point(${px}, ${py}, 0, ${vCap}, 8);${inlineComment}\n`
                : `${indent}chassis.drive_to_point(${px}, ${py});${inlineComment}\n`;
              break;
            case "moveToPose":
            case "bezierCurve":
              code += hasVolts
                ? `${indent}chassis.drive_to_pose(${px}, ${py}, ${pt}, 0.5, 0, ${vCap}, 8);${inlineComment}\n`
                : `${indent}chassis.drive_to_pose(${px}, ${py}, ${pt});${inlineComment}\n`;
              break;
            case "turnToPoint":
              code += `${indent}chassis.turn_to_point(${px}, ${py});${inlineComment}\n`;
              break;
            case "turnToHeading":
              code += hasVolts
                ? `${indent}chassis.turn_to_angle(${pt}, ${vCap});${inlineComment}\n`
                : `${indent}chassis.turn_to_angle(${pt});${inlineComment}\n`;
              break;
            case "swingToPoint":
            case "swingToHeading":
              code += `${indent}chassis.${a.lockedSide === "RIGHT" ? "right" : "left"}_swing_to_angle(${pt});${inlineComment}\n`;
              break;
          }
          continue;
        }

        // LemLib default
        const params = [];
        if (a.forwards === false) params.push(".forwards = false");
        if (a.type === "moveToPose" && a.lead != null && Number(a.lead) !== 0.6) {
          params.push(`.lead = ${Number(a.lead)}`);
        }
        if (a.driftScaler != null && Number(a.driftScaler) !== 1.0) {
          params.push(`.horizontalDrift = ${Number(a.driftScaler)}`);
        }
        if (a.maxSpeed != null && Number(a.maxSpeed) !== 127) {
          params.push(`.maxSpeed = ${Number(a.maxSpeed)}`);
        }
        if (a.minSpeed != null && Number(a.minSpeed) !== 0) {
          params.push(`.minSpeed = ${Number(a.minSpeed)}`);
        }
        if (a.earlyExitRange) params.push(`.earlyExitRange = ${a.earlyExitRange}`);
        const paramStr = params.length ? `, {${params.join(", ")}}` : "";
        const asyncArg = a.async ? ", true" : "";

        switch (a.type) {
          case "moveToPoint":
            code += `${indent}chassis.moveToPoint(${px}, ${py}, ${a.timeout || 2000}${paramStr}${asyncArg});${inlineComment}\n`;
            break;
          case "moveToPose":
          case "bezierCurve":
            code += `${indent}chassis.moveToPose(${px}, ${py}, ${pt}, ${a.timeout || 2500}${paramStr}${asyncArg});${inlineComment}\n`;
            break;
          case "turnToPoint":
            code += `${indent}chassis.turnToPoint(${px}, ${py}, ${a.timeout || 1500}${paramStr}${asyncArg});${inlineComment}\n`;
            break;
          case "turnToHeading":
            code += `${indent}chassis.turnToHeading(${pt}, ${a.timeout || 1500}${paramStr}${asyncArg});${inlineComment}\n`;
            break;
          case "swingToPoint":
            code += `${indent}chassis.swingToPoint(${px}, ${py}, DriveSide::${a.lockedSide || "LEFT"}, ${a.timeout || 1500}${paramStr}${asyncArg});${inlineComment}\n`;
            break;
          case "swingToHeading":
            code += `${indent}chassis.swingToHeading(${pt}, DriveSide::${a.lockedSide || "LEFT"}, ${a.timeout || 1500}${paramStr}${asyncArg});${inlineComment}\n`;
            break;
        }
      }
      return code;
    }

    generateAutonCppCode(plannerPaths, indent = "    ", library = null) {
      if (!plannerPaths || plannerPaths.length === 0) return "";
      const lib = normalizeLibId(library || this.getProjectLibrary());
      const libLabels = {
        lemlib: "VEX V5 LemLib",
        ez_template: "VEX V5 EZ-Template",
        rw_template: "VEXcode V5 RW-Template",
        jar_template: "VEXcode V5 JAR-Template",
      };
      const isVexcode = lib === "rw_template" || lib === "jar_template";
      let header = `// =================================================================\n` +
                   `// autons.cpp - Autonomous Routines for ${libLabels[lib] || "VEX V5"}\n` +
                   `// Generated & Synchronized with Visual Flowchart\n` +
                   `// =================================================================\n` +
                   (isVexcode
                     ? `#include "vex.h"\n#include "robot-config.h"\n\n`
                     : `#include "main.h"\n#include "robot-config.h"\n#include "subsystems.hpp"\n\n`);

      let bodies = "";
      plannerPaths.forEach((p, idx) => {
        const fnName = p.name ? p.name.toLowerCase().replace(/[^a-z0-9_]/g, "_") : `auton_${idx + 1}`;
        bodies += `// -----------------------------------------------------------------\n`;
        bodies += `// Routine ${idx + 1}: ${p.name || fnName}\n`;
        bodies += `// -----------------------------------------------------------------\n`;
        bodies += `void ${fnName}() {\n`;
        if (typeof window !== "undefined" && window.PlannerApp && typeof window.PlannerApp.emitRoutineBody === "function") {
          bodies += window.PlannerApp.emitRoutineBody(p.pose, p.actions, indent, lib);
        } else {
          bodies += this.fallbackEmitRoutineBody(p.pose, p.actions, indent, lib);
        }
        bodies += `}\n\n`;
      });

      return header + bodies;
    }

    // Check if the visual blocks code differs from existing src/autons.cpp
    hasCodeDifference(plannerPaths, indent = "    ") {
      const currentCode = this.getFile("src/autons.cpp") || "";
      const generatedCode = this.generateAutonCppCode(plannerPaths, indent);
      
      const normalize = (s) => s.replace(/\s+/g, " ").trim();
      return normalize(currentCode) !== normalize(generatedCode);
    }

    // Smart Merge of visual planner paths into src/autons.cpp
    mergePlannerIntoAutonCpp(plannerPaths, mode = "replace", indent = "    ", options = {}) {
      if (mode === "keep") return this.getFile("src/autons.cpp");

      const lib = normalizeLibId(options.library || this.getProjectLibrary());
      const existing = this.getFile("src/autons.cpp") || "";
      if (existing.trim().length > 0) {
        this.createVersionSnapshot(
          "src/autons.cpp",
          mode === "replace" ? "blocks_merge" : "blocks_append",
          `Preserved Raw C++ before Blocks ${mode === "replace" ? "Replace" : "Append"}`
        );
      }

      const generated = this.generateAutonCppCode(plannerPaths, indent, lib);
      if (mode === "replace") {
        this.setFile("src/autons.cpp", generated);
        if (this.project) {
          this.project.lastAutonEditor = "blocks";
          this.project.rawCppPreserved = false;
        }
        return generated;
      }

      if (mode === "append") {
        const existingRoutines = this.getAutonRoutines();
        const existingNames = new Set(existingRoutines.map(r => r.name.toLowerCase()));

        let appendBodies = "";
        plannerPaths.forEach((p, idx) => {
          const fnName = p.name ? p.name.toLowerCase().replace(/[^a-z0-9_]/g, "_") : `auton_${idx + 1}`;
          if (!existingNames.has(fnName)) {
            appendBodies += `\n// -----------------------------------------------------------------\n`;
            appendBodies += `// Appended Routine: ${p.name || fnName}\n`;
            appendBodies += `// -----------------------------------------------------------------\n`;
            appendBodies += `void ${fnName}() {\n`;
            if (typeof window !== "undefined" && window.PlannerApp && typeof window.PlannerApp.emitRoutineBody === "function") {
              appendBodies += window.PlannerApp.emitRoutineBody(p.pose, p.actions, indent, lib);
            } else {
              appendBodies += this.fallbackEmitRoutineBody(p.pose, p.actions, indent, lib);
            }
            appendBodies += `}\n`;
          }
        });

        const merged = existing + (appendBodies ? "\n" + appendBodies : "");
        this.setFile("src/autons.cpp", merged);
        if (this.project) {
          this.project.lastAutonEditor = "blocks";
          this.project.rawCppPreserved = false;
        }
        return merged;
      }

      return generated;
    }

    // Synchronize visual planner paths into src/autons.cpp safely
    updateAutonCppFromPlanner(plannerPaths, indent = "    ", options = {}) {
      const existing = this.getFile("src/autons.cpp") || "";
      const hasDiff = this.hasCodeDifference(plannerPaths, indent);

      if (hasDiff && existing.trim().length > 0) {
        // ALWAYS snapshot raw C++ before any sync or replacement
        this.createVersionSnapshot(
          "src/autons.cpp",
          "before_blocks_sync",
          "Preserved Raw C++ (Before Blocks Sync)"
        );

        // Safeguard: do not silently overwrite raw C++ if last editor was the IDE and not forced
        if (!options.force && (this.project?.lastAutonEditor === "ide" || this.project?.rawCppPreserved)) {
          console.log("🛡️ Preserving raw C++ code from IDE; version snapshotted. Not overwriting automatically.");
          if (this.project) this.project.rawCppPreserved = true;
          return existing;
        }
      }

      return this.mergePlannerIntoAutonCpp(plannerPaths, options.mode || "replace", indent, options);
    }

    // -------------------------------------------------------------
    // Comprehensive Multi-File C++ Syntax Analysis & Diagnostics Engine
    // -------------------------------------------------------------
    analyzeCodeDiagnostics(fileName, content, declaredSymbols = null) {
      const errors = [];
      const warnings = [];
      if (!content || typeof content !== "string") return { errors, warnings };

      const lines = content.split("\n");
      let inBlockComment = false;
      let blockCommentStartLine = 0;

      // Symbol set for variables, devices, and types across LemLib, EZ-Template, RW-Template, JAR-Template
      const symbolSet = declaredSymbols || new Set([
        ...(this.symbols?.motors || []).map(m => m.name),
        ...(this.symbols?.pistons || []).map(p => p.name),
        ...(this.symbols?.sensors || []).map(s => s.name),
        ...(this.symbols?.chassis || []).map(c => c.name),
        ...(this.symbols?.functions || []).map(f => f.name),
        "chassis", "pros", "lemlib", "ez", "vex", "delay", "wait", "printf",
        "Brain", "Controller", "Controller1", "Master", "Inertial",
        "intake", "clamp", "piston", "doinker", "lift",
        "left_motors", "right_motors", "LeftDrive", "RightDrive",
        "DRIVE_SPEED", "TURN_SPEED", "SWING_SPEED", "Competition"
      ]);

      const validTypesAndKeywords = new Set([
        "int", "double", "float", "bool", "char", "auto", "void", "uint8_t", "uint16_t", "uint32_t", "int8_t", "int16_t", "int32_t", "size_t",
        "return", "break", "continue", "goto", "using", "namespace", "typedef", "struct", "class", "enum", "union",
        "if", "else", "while", "for", "switch", "case", "default", "try", "catch", "public", "private", "protected",
        "const", "static", "volatile", "extern", "unsigned", "signed", "inline", "virtual", "override", "constexpr",
        "pros", "lemlib", "ez", "vex", "chassis", "Drive", "Chassis", "Motor", "ADIPiston", "Imu", "Distance", "Optical", "Rotation", "Controller",
        "ControllerSettings", "Drivetrain", "OdomSensors", "TrackingWheel", "Pose"
      ]);

      // Global bracket stack to detect nesting mismatches across block structures
      const globalBracketStack = [];
      let statementBuffer = "";
      let statementStartLine = 0;

      lines.forEach((rawLine, idx) => {
        const lineNum = idx + 1;
        let line = rawLine.trim();

        // 1. Handle block comments /* ... */
        if (inBlockComment) {
          if (line.includes("*/")) {
            inBlockComment = false;
            line = line.substring(line.indexOf("*/") + 2).trim();
          } else {
            return;
          }
        }

        if (line.includes("/*")) {
          const commentStartIdx = line.indexOf("/*");
          const commentEndIdx = line.indexOf("*/", commentStartIdx + 2);
          if (commentEndIdx !== -1) {
            line = (line.substring(0, commentStartIdx) + " " + line.substring(commentEndIdx + 2)).trim();
          } else {
            inBlockComment = true;
            blockCommentStartLine = lineNum;
            line = line.substring(0, commentStartIdx).trim();
          }
        }

        // Strip inline comments //
        let codePart = line;
        if (codePart.includes("//")) {
          codePart = codePart.substring(0, codePart.indexOf("//")).trim();
        }

        if (!codePart) return;

        // 2. Pre-processor Directives (#include, #define, #pragma, etc.)
        if (codePart.startsWith("#")) {
          if (codePart.startsWith("#include")) {
            const matchInc = codePart.match(/#include\s+([<"][^>"]+[>"])/);
            if (!matchInc) {
              errors.push({
                file: fileName,
                line: lineNum,
                message: `SyntaxError: #include filename must be enclosed in <...> or "..." (got '${codePart}')`,
              });
            }
          } else if (codePart === "#define" || /^#define\s*$/.test(codePart)) {
            errors.push({
              file: fileName,
              line: lineNum,
              message: `SyntaxError: Expected macro name after #define`,
            });
          }
          return;
        }

        // 3. String literal validation & string stripping
        let codeWithoutStrings = "";
        let inString = false;
        let stringQuote = "";

        for (let i = 0; i < codePart.length; i++) {
          const ch = codePart[i];
          const prevCh = i > 0 ? codePart[i - 1] : "";

          if (inString) {
            if (ch === stringQuote && prevCh !== "\\") {
              inString = false;
            }
          } else {
            if (ch === '"' || ch === "'") {
              inString = true;
              stringQuote = ch;
            } else {
              codeWithoutStrings += ch;
            }
          }
        }

        if (inString) {
          errors.push({
            file: fileName,
            line: lineNum,
            message: `SyntaxError: Unclosed string literal (${stringQuote})`,
          });
        }

        // 4. Bracket Nesting Stack & Matching ([{ }])
        const lineBracketStack = [];
        for (let i = 0; i < codeWithoutStrings.length; i++) {
          const c = codeWithoutStrings[i];
          if (c === "{" || c === "(" || c === "[") {
            const item = { char: c, line: lineNum };
            lineBracketStack.push(item);
            globalBracketStack.push(item);
          } else if (c === "}" || c === ")" || c === "]") {
            const expectedChar = c === "}" ? "{" : c === ")" ? "(" : "[";

            if (lineBracketStack.length > 0) {
              const top = lineBracketStack.pop();
              if (top.char !== expectedChar) {
                errors.push({
                  file: fileName,
                  line: lineNum,
                  message: `SyntaxError: Mismatched bracket '${c}' (expected '${top.char === "{" ? "}" : top.char === "(" ? ")" : "]"}' to close '${top.char}')`,
                });
              }
            }

            if (globalBracketStack.length > 0) {
              const topG = globalBracketStack.pop();
              if (topG.char !== expectedChar && lineBracketStack.length === 0) {
                if (topG.line !== lineNum) {
                  errors.push({
                    file: fileName,
                    line: lineNum,
                    message: `SyntaxError: Mismatched bracket '${c}' (opened '${topG.char}' at line ${topG.line})`,
                  });
                }
              }
            } else {
              errors.push({
                file: fileName,
                line: lineNum,
                message: `SyntaxError: Unexpected closing bracket '${c}' without matching opening bracket`,
              });
            }
          }
        }

        const isInsideParensOrBrackets = globalBracketStack.some(item => item.char === "(" || item.char === "[");
        const isForLoopHeader = /\bfor\s*\([^)]*$/.test(statementBuffer ? (statementBuffer + " " + codeWithoutStrings) : codeWithoutStrings);

        // If a statement terminates with ';' on this line but has unclosed parenthesis/bracket on this statement
        if (codeWithoutStrings.endsWith(";") && !isForLoopHeader) {
          if (lineBracketStack.length > 0) {
            const unclosed = lineBracketStack[lineBracketStack.length - 1];
            errors.push({
              file: fileName,
              line: lineNum,
              message: `SyntaxError: Unclosed '${unclosed.char}' before ';' in statement '${codePart}'`,
            });
          }
        }

        // 5. Check Double Operators & Syntax Typos
        if (/,,/.test(codeWithoutStrings)) {
          errors.push({
            file: fileName,
            line: lineNum,
            message: `SyntaxError: Unexpected consecutive commas ',,' in expression`,
          });
        }

        // 6. Check assignment operator '=' inside conditional if/while
        const ifCondMatch = codeWithoutStrings.match(/\b(if|while)\s*\(([^)]+)\)/);
        if (ifCondMatch) {
          const cond = ifCondMatch[2].trim();
          if (!cond) {
            errors.push({
              file: fileName,
              line: lineNum,
              message: `SyntaxError: Empty condition inside '${ifCondMatch[1]}()'`,
            });
          } else if (/\b[a-zA-Z0-9_]+\s*=\s*[^=!]/.test(cond) && !/==|<=|>=|!=/.test(cond)) {
            warnings.push({
              file: fileName,
              line: lineNum,
              message: `Warning: Single assignment '=' inside '${ifCondMatch[1]}' condition. Did you mean '=='?`,
            });
          }
        }

        // 7. Statement Completion & Syntax Validation
        const isControlStructure = /^(if|else|while|for|switch|case|default|try|catch|namespace|class|struct|enum|public|private|protected|typedef|using|template)\b/.test(codeWithoutStrings);
        const isFunctionOrLambda =
          /^(?:(?:inline|static|virtual|extern|explicit|friend|constexpr|consteval|constinit)\s+)*(?:[a-zA-Z0-9_:<>\*\&\s]+)\s+[a-zA-Z0-9_:<>]+\s*\([^)]*\)(?:\s*(?:const|override|final|noexcept))*\s*$/.test(codeWithoutStrings) ||
          /^~?[a-zA-Z0-9_]+\s*\([^)]*\)\s*(?::\s*.*)?$/.test(codeWithoutStrings) || // Constructor / Destructor / Initializer
          /\[[^\]]*\]\s*(?:\([^)]*\))?\s*(?:->\s*[a-zA-Z0-9_:<>\*\&]+)?\s*$/.test(codeWithoutStrings) || // Lambda
          /^[a-zA-Z0-9_:]+\s*\([^)]*\)\s*$/.test(codeWithoutStrings); // Direct function or macro call header
        const isMacroOrDirective = /^[A-Z0-9_]+\s*\([^)]*\)$/.test(codeWithoutStrings) || codePart.startsWith("#");
        const isChainedOrOperatorEnding = /[.+*\/=,&|!?:<>(^%~-]$/.test(codeWithoutStrings) || codeWithoutStrings.endsWith("::") || codeWithoutStrings.endsWith("->");

        const isLineEndingValid =
          codeWithoutStrings.endsWith(";") ||
          codeWithoutStrings.endsWith("{") ||
          codeWithoutStrings.endsWith("}") ||
          codeWithoutStrings.endsWith(":") ||
          codeWithoutStrings.endsWith(",") ||
          codeWithoutStrings.endsWith("\\") ||
          codeWithoutStrings.endsWith("(") ||
          codeWithoutStrings.endsWith("[") ||
          codeWithoutStrings.endsWith(")") ||
          codeWithoutStrings.endsWith(">") ||
          isChainedOrOperatorEnding ||
          isControlStructure ||
          isFunctionOrLambda ||
          isMacroOrDirective ||
          isInsideParensOrBrackets;

        if (!isControlStructure && !isLineEndingValid && !isFunctionOrLambda && !isMacroOrDirective && globalBracketStack.length === 0) {
          warnings.push({
            file: fileName,
            line: lineNum,
            message: `Linter hint: Statement may be missing ';' or continuing on next line: '${codePart}'`,
          });
          statementBuffer = "";
          statementStartLine = 0;
        }

        // Accumulate multi-line statements
        if (!statementBuffer) {
          statementStartLine = lineNum;
        }
        statementBuffer += (statementBuffer ? " " : "") + codeWithoutStrings;

        // When a statement finishes at ';' and we are not inside multi-line parens/brackets
        if (codeWithoutStrings.endsWith(";") && !isInsideParensOrBrackets) {
          const fullStmt = statementBuffer.replace(/;$/, "").trim();
          statementBuffer = "";
          statementStartLine = 0;

          if (fullStmt && !/^[)\]}\s]+$/.test(fullStmt)) {
            const isFunctionCall = /[a-zA-Z0-9_:]+\s*\([^)]*\)/.test(fullStmt);
            const isAssignmentOrOp = /=|\+=|-=|\*=|\/=|%=|\+\+|--|<<|>>/.test(fullStmt);
            const isReturnOrBreak = /^(return|break|continue|goto)\b/.test(fullStmt);
            const isDeclaration = /^(?:const\s+|static\s+|volatile\s+|extern\s+|unsigned\s+|signed\s+|inline\s+|constexpr\s+)*([a-zA-Z0-9_:<>\*\&]+)\s+([a-zA-Z0-9_]+)/.test(fullStmt);

            if (!isFunctionCall && !isAssignmentOrOp && !isReturnOrBreak && !isDeclaration) {
              const shortStmt = fullStmt.length > 45 ? fullStmt.slice(0, 42) + "..." : fullStmt;
              // Informational warning only; do not fail compilation for custom C++ templates/macros
              warnings.push({
                file: fileName,
                line: lineNum,
                message: `Linter notice: Could not deduce declaration signature for '${shortStmt}'`,
              });
            }
          }
        } else if (codeWithoutStrings.endsWith("{") || codeWithoutStrings.endsWith("}")) {
          statementBuffer = "";
          statementStartLine = 0;
        }

        // 8. LemLib API Parameter Validation (Supports Pose overloads & coordinates)
        const mtPoint = codeWithoutStrings.match(/chassis\.moveToPoint\s*\(([^)]*)\)/);
        if (mtPoint && !mtPoint[1].includes("{")) {
          const args = mtPoint[1].split(",").map(a => a.trim()).filter(Boolean);
          if (args.length === 0) {
            warnings.push({
              file: fileName,
              line: lineNum,
              message: `Notice: chassis.moveToPoint requires target coordinates (x, y) or a LemLib Pose.`,
            });
          }
        }

        const mtPose = codeWithoutStrings.match(/chassis\.moveToPose\s*\(([^)]*)\)/);
        if (mtPose && !mtPose[1].includes("{")) {
          const args = mtPose[1].split(",").map(a => a.trim()).filter(Boolean);
          if (args.length === 0) {
            warnings.push({
              file: fileName,
              line: lineNum,
              message: `Notice: chassis.moveToPose requires target pose (x, y, theta) or LemLib Pose object.`,
            });
          }
        }

        const ttHeading = codeWithoutStrings.match(/chassis\.turnToHeading\s*\(([^)]*)\)/);
        if (ttHeading) {
          const args = ttHeading[1].split(",").map(a => a.trim()).filter(Boolean);
          if (args.length < 1) {
            warnings.push({
              file: fileName,
              line: lineNum,
              message: `Notice: chassis.turnToHeading expected heading angle argument theta.`,
            });
          }
        }

        const ttPoint = codeWithoutStrings.match(/chassis\.turnToPoint\s*\(([^)]*)\)/);
        if (ttPoint) {
          const args = ttPoint[1].split(",").map(a => a.trim()).filter(Boolean);
          if (args.length < 1) {
            warnings.push({
              file: fileName,
              line: lineNum,
              message: `Notice: chassis.turnToPoint expected target coordinates or Pose object.`,
            });
          }
        }

        const setPose = codeWithoutStrings.match(/chassis\.setPose\s*\(([^)]*)\)/);
        if (setPose) {
          const args = setPose[1].split(",").map(a => a.trim()).filter(Boolean);
          // LemLib supports: chassis.setPose(x, y, theta), chassis.setPose(pose), chassis.setPose({x, y, theta}), chassis.setPose(pose, radians)
          if (args.length === 0) {
            warnings.push({
              file: fileName,
              line: lineNum,
              message: `Notice: chassis.setPose requires at least 1 argument (Pose object or x, y, theta coordinates).`,
            });
          }
        }

        // LemLib method capitalization typos
        const typoMatch = codeWithoutStrings.match(/chassis\.(movetopoint|movetoPose|turntoheading|turntopoint|setpose)\s*\(/i);
        if (typoMatch) {
          const called = typoMatch[1];
          if (!["moveToPoint", "moveToPose", "turnToHeading", "turnToPoint", "setPose", "swingToPoint", "swingToHeading", "waitUntil", "waitUntilDone"].includes(called)) {
            warnings.push({
              file: fileName,
              line: lineNum,
              message: `Warning: Case typo in 'chassis.${called}'. LemLib API methods are camelCase`,
            });
          }
        }

        // 9. VEX V5 Smart Port Range Checks
        const motorPortMatch = codeWithoutStrings.match(/pros::Motor\s+[a-zA-Z0-9_]+\s*\(\s*(-?\d+)\s*/);
        if (motorPortMatch) {
          const port = parseInt(motorPortMatch[1], 10);
          const absPort = Math.abs(port);
          if (absPort < 1 || absPort > 21) {
            errors.push({
              file: fileName,
              line: lineNum,
              message: `SyntaxError: Invalid VEX V5 Smart Port ${port}. Smart ports must be between 1 and 21 (or negative for reversed)`,
            });
          }
        }

        // 10. Undefined Symbol Check (only flags `.` member access on undeclared variables; allows chassis, ez, vex, Brain, etc.)
        if (fileName.endsWith(".cpp") || fileName.endsWith(".c")) {
          const tokenMatch = codeWithoutStrings.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.(move|spin|stop|set|set_value|get_value|moveToPoint|moveToPose|turnToHeading|odom_xyt_set|pid_odom_set|pid_drive_set|pid_turn_set|pid_swing_set|pid_wait|set_coordinates|drive_to_point|drive_to_pose|turn_to_angle|drive_distance)/);
          if (tokenMatch && tokenMatch[1]) {
            const varName = tokenMatch[1];
            if (!symbolSet.has(varName) && !validTypesAndKeywords.has(varName)) {
              warnings.push({
                file: fileName,
                line: lineNum,
                message: `'${varName}' was used but not explicitly declared in robot-config.h`,
              });
            }
          }
        }
      });

      // End-of-file checks
      if (inBlockComment) {
        errors.push({
          file: fileName,
          line: blockCommentStartLine || lines.length,
          message: `SyntaxError: Unclosed block comment '/*' starting at line ${blockCommentStartLine}`,
        });
      }

      if (globalBracketStack.length > 0) {
        globalBracketStack.forEach(unclosed => {
          const closingChar = unclosed.char === "{" ? "}" : unclosed.char === "(" ? ")" : "]";
          errors.push({
            file: fileName,
            line: unclosed.line,
            message: `SyntaxError: Unclosed bracket '${unclosed.char}' (expected matching '${closingChar}')`,
          });
        });
      }

      return { errors, warnings };
    }

    // -------------------------------------------------------------
    // Multi-File Project Compiler Engine (Emulates `pros make` / VEXcode build)
    // -------------------------------------------------------------
    compileProject() {
      const startTime = performance.now();
      const files = this.project?.files || {};
      const fileNames = Object.keys(files);
      const lib = this.getProjectLibrary();
      const isVexcode = lib === "rw_template" || lib === "jar_template";
      const toolchainBanner = {
        lemlib: "PROS 4 + LemLib v0.5.4",
        ez_template: "PROS 4 + EZ-Template v3+",
        rw_template: "VEXcode V5 Pro + RW-Template",
        jar_template: "VEXcode V5 Pro + JAR-Template",
      }[lib] || "PROS 4 + LemLib";

      const logs = [];
      const errors = [];
      const warnings = [];

      logs.push(isVexcode ? ">> vexcom / arm-none-eabi-g++ make" : ">> pros make");
      logs.push(`Compiling ${toolchainBanner} project for VEX V5 (ARM Cortex-A9 Neon)...`);
      logs.push(`Project Name: ${this.project?.name || "VEX_Bot"} | Toolchain: ${toolchainBanner}`);
      logs.push("----------------------------------------------------------------------");

      // Verify essential headers and source files
      const hasHeaders = files["include/main.h"] || files["include/vex.h"] || Object.keys(files).some(f => f.endsWith(".h") || f.endsWith(".hpp"));
      const hasSrc = Object.keys(files).some(f => f.endsWith(".cpp") || f.endsWith(".c"));
      if (!hasHeaders) {
        warnings.push({
          file: isVexcode ? "include/vex.h" : "include/main.h",
          line: 1,
          message: `Standard project header (${isVexcode ? "include/vex.h" : "include/main.h"}) not found.`,
        });
      }
      if (!hasSrc) {
        warnings.push({
          file: "src/main.cpp",
          line: 1,
          message: `No C++ source files found in workspace. Add or import C++ source files.`,
        });
      }

      // Symbol references check across project
      this.indexVariables();
      const declaredSymbols = new Set([
        ...(this.symbols?.motors || []).map(m => m.name),
        ...(this.symbols?.pistons || []).map(p => p.name),
        ...(this.symbols?.sensors || []).map(s => s.name),
        ...(this.symbols?.chassis || []).map(c => c.name),
        ...(this.symbols?.functions || []).map(f => f.name),
        "chassis", "pros", "lemlib", "ez", "vex", "delay", "wait", "millis", "printf", "lcd", "battery", "master",
        "Brain", "Controller", "Controller1", "Inertial", "Competition",
        "intake", "clamp", "doinker", "lift", "imu", "horiz_wheel", "vertical_wheel", "sensors",
        "left_motors", "right_motors", "LeftDrive", "RightDrive",
        "drivetrain", "lateral_controller", "angular_controller", "Pose", "AngularDirection", "DriveSide",
        "Motor", "MotorGroup", "Imu", "Rotation", "Distance", "Optical", "Gps", "Vision",
        "ADIEncoder", "ADIDigitalOut", "ADIDigitalIn", "Pneumatics", "Task", "Mutex",
        "E_CONTROLLER_MASTER", "E_CONTROLLER_ANALOG_LEFT_Y", "E_CONTROLLER_ANALOG_RIGHT_X",
        "E_CONTROLLER_DIGITAL_R1", "E_CONTROLLER_DIGITAL_R2", "E_CONTROLLER_DIGITAL_L1", "E_CONTROLLER_DIGITAL_L2"
      ]);

      // Scan all project source and header files for diagnostics
      const cppFiles = fileNames.filter(f => f.endsWith(".cpp") || f.endsWith(".c"));
      const projectFilesToScan = fileNames.filter(f => f.endsWith(".cpp") || f.endsWith(".c") || f.endsWith(".h") || f.endsWith(".hpp"));

      projectFilesToScan.forEach(fileName => {
        const content = files[fileName];
        logs.push(`CXX ${fileName}`);
        if (!content || typeof content !== "string") return;

        const diag = this.analyzeCodeDiagnostics(fileName, content, declaredSymbols);
        errors.push(...diag.errors);
        warnings.push(...diag.warnings);
      });

      // Link step
      logs.push("LINK bin/cold.package.elf");
      logs.push("STRIP bin/hot.package.bin (Dynamic user payload)");
      logs.push("Creating VEXos Monolithic Package bundle...");

      // Append detailed compiler diagnostics into build output logs (GCC/Clang format)
      if (errors.length > 0) {
        errors.forEach(err => {
          logs.push(`${err.file}:${err.line}:1: error: ${err.message}`);
        });
      }
      if (warnings.length > 0) {
        warnings.forEach(warn => {
          logs.push(`${warn.file}:${warn.line}:1: warning: ${warn.message}`);
        });
      }

      const success = errors.length === 0;
      const elapsed = ((performance.now() - startTime) / 1000 + 0.35).toFixed(2);

      // Memory footprint emulation
      const textBytes = 142580 + (cppFiles.length * 4200);
      const dataBytes = 4120;
      const bssBytes = 28400;
      const totalFlash = textBytes + dataBytes;
      const totalRam = dataBytes + bssBytes;

      const flashMax = 32 * 1024 * 1024; // 32MB
      const ramMax = 32 * 1024 * 1024; // 32MB

      logs.push("----------------------------------------------------------------------");
      if (success) {
        logs.push(`✅ BUILD SUCCEEDED in ${elapsed}s`);
        logs.push(`Flash (ROM): ${(totalFlash / 1024).toFixed(1)} KB / 32 MB (${((totalFlash / flashMax) * 100).toFixed(2)}%)`);
        logs.push(`RAM (BSS/Data): ${(totalRam / 1024).toFixed(1)} KB / 32 MB (${((totalRam / ramMax) * 100).toFixed(2)}%)`);
        logs.push(`Ready for upload to VEX V5 Brain (Slot 1–8).`);
      } else {
        logs.push(`❌ BUILD FAILED: ${errors.length} error(s), ${warnings.length} warning(s)`);
      }

      return {
        success,
        elapsed,
        logs: logs.join("\n"),
        errors,
        warnings,
        stats: {
          flashBytes: totalFlash,
          ramBytes: totalRam,
          flashPct: (totalFlash / flashMax) * 100,
          ramPct: (totalRam / ramMax) * 100,
        }
      };
    }

    async compressFiles(filesObj) {
      if (!filesObj || typeof filesObj !== "object" || Object.keys(filesObj).length === 0) return null;
      try {
        const jsonStr = JSON.stringify(filesObj);
        if (typeof CompressionStream !== "undefined") {
          const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream("gzip"));
          const response = new Response(stream);
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);
          let binary = "";
          const len = uint8.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          return btoa(binary);
        } else if (typeof JSZip !== "undefined") {
          const zip = new JSZip();
          for (const [path, content] of Object.entries(filesObj)) {
            zip.file(path, content);
          }
          return await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
        }
      } catch (err) {
        console.warn("[ProjectManager] Compression error:", err);
      }
      return null;
    }

    async decompressFiles(compressedStr) {
      if (!compressedStr || typeof compressedStr !== "string") return null;
      try {
        if (typeof DecompressionStream !== "undefined") {
          try {
            const binStr = atob(compressedStr);
            const bytes = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) {
              bytes[i] = binStr.charCodeAt(i);
            }
            const decompStream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
            const decompText = await new Response(decompStream).text();
            const parsed = JSON.parse(decompText);
            if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
              return parsed;
            }
          } catch (_) {}
        }
        if (typeof JSZip !== "undefined") {
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(compressedStr, { base64: true });
          const filesMap = {};
          for (const [path, fileObj] of Object.entries(loadedZip.files)) {
            if (!fileObj.dir) {
              filesMap[path] = await fileObj.async("text");
            }
          }
          if (Object.keys(filesMap).length > 0) return filesMap;
        }
      } catch (err) {
        console.warn("[ProjectManager] Decompression error:", err);
      }
      return null;
    }

    // -------------------------------------------------------------
    // Cloud Sync (Server & Firebase Firestore Dual-Cloud Integration)
    // -------------------------------------------------------------
    async saveToCloud(onProgress = null, onlyChanges = true) {
      if (typeof window !== "undefined" && window.SessionGuard && !window.SessionGuard.isInstanceActive()) {
        console.warn("[ProjectManager] Save aborted: Instance is deactivated by single-instance session guard.");
        return false;
      }
      if (!this.project) return false;
      let user = null;
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        user = firebase.auth().currentUser;
      }
      let savedUser = null;
      try {
        const raw = localStorage.getItem("lemlib_saved_google_user");
        if (raw) savedUser = JSON.parse(raw);
      } catch (_) {}
      const uid = (user && user.uid) || (savedUser && savedUser.uid) || "";
      const email = (user && user.email) || (savedUser && savedUser.email) || localStorage.getItem("lemlib_saved_google_email") || "";

      if (!uid && !email) {
        throw new Error("You must be signed in with Google to sync project to cloud");
      }

      // Check if full sync is required (e.g. newly imported or forced)
      const needsFullSync = !this.project.cloudSynced || !onlyChanges;
      const hasChanges = this.isDirty || (this.changedFiles && this.changedFiles.size > 0);
      if (!needsFullSync && !hasChanges) {
        if (typeof onProgress === "function") {
          onProgress(0, 0, this.formatSavingProgress(0, 0));
        }
        return true;
      }

      const isDelta = !needsFullSync && this.changedFiles && this.changedFiles.size > 0;
      const totalBytes = isDelta ? this.getChangedSizeBytes() : this.getProjectSizeBytes();
      const emit = (curr) => {
        const clamped = Math.min(curr, totalBytes);
        if (typeof onProgress === "function") {
          try {
            onProgress(clamped, totalBytes, this.formatSavingProgress(clamped, totalBytes));
          } catch (e) {
            console.error("Cloud progress error:", e);
          }
        }
      };

      emit(Math.max(1, Math.round(totalBytes * 0.25)));

      const now = Date.now();
      this.project.updatedAt = now;
      this.project.isDefault = false;

      // Automatically sync project to user's Google Drive as the primary cloud persistence
      if (typeof window !== "undefined" && window.GoogleDriveSync) {
        try {
          await window.GoogleDriveSync.saveProject(this.project);
          console.log(`[ProjectManager] Auto-saved project to Google Drive: "${this.project.name}"`);
        } catch (gErr) {
          console.warn("[ProjectManager] Background Google Drive save notice:", gErr.message);
        }
      }

      // 1. Prepare clean files & compressed payload
      const cleanFiles = this.cleanFilesForFirestore(this.project.files || {});
      const compressedPayload = await this.compressFiles(cleanFiles);

      // Primary source files (src/* and non-library headers)
      const primaryFiles = {};
      for (const [p, c] of Object.entries(cleanFiles)) {
        if (p.startsWith("src/") || (p.startsWith("include/") && !p.startsWith("include/pros/") && !p.startsWith("include/lemlib/"))) {
          primaryFiles[p] = c;
        }
      }
      if (Object.keys(primaryFiles).length === 0) {
        let sizeAccum = 0;
        for (const [p, c] of Object.entries(cleanFiles)) {
          if (sizeAccum + c.length < 50 * 1024) {
            primaryFiles[p] = c;
            sizeAccum += c.length;
          }
        }
      }

      const totalFilesJsonSize = JSON.stringify(cleanFiles).length;
      const filesField = totalFilesJsonSize < 350 * 1024 ? cleanFiles : primaryFiles;

      // 2. Persist to Server Cloud Store if available
      try {
        const srvUrl = getApiUrl("/api/project");
        if (srvUrl) {
          const payloadProject = { ...this.project, versions: this.versions || {} };
          const resp = await fetch(srvUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uid: uid,
              email: email,
              project: payloadProject
            })
          });
          if (resp.ok) {
            console.log(`[ProjectManager] Saved project to server cloud store: "${this.project.name}"`);
          }
        }
      } catch (srvErr) {
        // Non-blocking server save warning
      }

      emit(Math.round(totalBytes * 0.55));

      // 3. Persist to Firebase Firestore
      if (typeof firebase !== "undefined" && firebase.firestore && user) {
        try {
          const db = firebase.firestore();
          const projectRef = db.collection("users").doc(user.uid).collection("data").doc("active_project");

          const docPayload = {
            name: this.project.name || "Override_LemLib_Bot",
            version: this.project.version || "1.0.0",
            target: this.project.target || "v5",
            kernel: this.project.kernel || "4.1.0",
            lemlibVersion: this.project.lemlibVersion || "0.5.4",
            activeAuton: this.project.activeAuton || "red_rush_auton",
            updatedAt: now,
            authorEmail: user.email || email,
            isDefault: false,
            totalFiles: Object.keys(cleanFiles).length,
            files: (totalFilesJsonSize < 200 * 1024 && (!compressedPayload || compressedPayload.length < 500000)) ? cleanFiles : primaryFiles,
            chunkCount: 0,
            isChunked: false,
            versions: this.versions || {}
          };

          const MAX_DOC_PROPERTY_CHARS = 600000;
          if (compressedPayload && compressedPayload.length > MAX_DOC_PROPERTY_CHARS) {
            // Split into safe subcollection chunks to guarantee never exceeding Firestore 1MB document limit
            const CHUNK_SIZE = 400000;
            const chunkCount = Math.ceil(compressedPayload.length / CHUNK_SIZE);
            docPayload.compressedFiles = null;
            docPayload.chunkCount = chunkCount;
            docPayload.isChunked = true;

            const chunksColl = projectRef.collection("chunks");
            const chunkPromises = [];
            for (let i = 0; i < chunkCount; i++) {
              const chunkStr = compressedPayload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
              chunkPromises.push(chunksColl.doc(`chunk_${i}`).set({
                chunkIndex: i,
                totalChunks: chunkCount,
                data: chunkStr,
                updatedAt: now
              }));
            }
            await Promise.all(chunkPromises);
          } else if (compressedPayload) {
            docPayload.compressedFiles = compressedPayload;
            docPayload.chunkCount = 0;
            docPayload.isChunked = false;
          }

          await projectRef.set(docPayload, { merge: true });
          console.log(`[ProjectManager] Firestore saved: "${this.project.name}" (${Object.keys(cleanFiles).length} files, chunked: ${Boolean(docPayload.isChunked)})`);
        } catch (fsErr) {
          console.warn("[ProjectManager] Firestore save notice:", fsErr);
        }
      }

      emit(Math.round(totalBytes * 0.85));

      this.changedFiles.clear();
      this.markDirty(false);
      this.recordSavedBaseline();
      this.project.cloudSynced = true;
      await this.saveLocal(false);
      emit(totalBytes);
      return true;
    }

    async loadFromCloud(force = false) {
      let user = null;
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        user = firebase.auth().currentUser;
      }
      let savedUser = null;
      try {
        const raw = localStorage.getItem("lemlib_saved_google_user");
        if (raw) savedUser = JSON.parse(raw);
      } catch (_) {}
      const uid = (user && user.uid) || (savedUser && savedUser.uid) || "";
      const email = (user && user.email) || (savedUser && savedUser.email) || localStorage.getItem("lemlib_saved_google_email") || "";

      if (!uid && !email) {
        throw new Error("You must be signed in with Google to load project from cloud");
      }

      const isJustLoggedIn = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("lemlib_just_logged_in") === "true");
      if (isJustLoggedIn) {
        console.log("[ProjectManager] User just logged in. Deleting local copy and forcing cloud sync.");
        try {
          localStorage.removeItem(STORAGE_KEY_PROJECT);
          localStorage.removeItem(STORAGE_KEY_PROJECT_DIRTY);
          await idbDelete(IDB_PROJECT_KEY);
        } catch (e) {
          console.warn("Error deleting local copy during login:", e);
        }
        force = true;
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("lemlib_just_logged_in");
        }
        this.project = null;
        this.isDirty = false;
        this.changedFiles.clear();
      }

      let candidateData = null;
      let candidateSource = "";

      // Helper to check if a loaded data is default template
      const checkCandidateDefault = (cand) => {
        if (!cand) return true;
        if (cand.isDefault === true) return true;
        const files = cand.files || {};
        const keys = Object.keys(files);
        const defaultKeys = Object.keys(DEFAULT_TEMPLATES);
        if (keys.length === 0) return true;
        if (keys.length === defaultKeys.length) {
          const isExactTemplates = defaultKeys.every(k => files[k] !== undefined && files[k] === DEFAULT_TEMPLATES[k]);
          if (isExactTemplates) return true;
        }
        return false;
      };

      // 1. Fetch from Server Cloud Store
      try {
        const params = new URLSearchParams();
        if (uid) params.set("uid", uid);
        if (email) params.set("email", email);
        const srvUrl = getApiUrl(`/api/project?${params.toString()}`);
        if (srvUrl) {
          const resp = await fetch(srvUrl);
          if (resp.ok) {
            const json = await resp.json();
            if (json.exists && json.project) {
              candidateData = json.project;
              candidateSource = "server";
            }
          }
        }
      } catch (err) {
        // Ignore server network errors
      }

      // 2. Check Firebase Firestore if signed in
      if (typeof firebase !== "undefined" && firebase.firestore && user) {
        try {
          const db = firebase.firestore();
          const projectRef = db.collection("users").doc(user.uid).collection("data").doc("active_project");
          const snap = await projectRef.get();
          if (snap.exists) {
            const fsData = snap.data();
            if (fsData.isChunked || (fsData.chunkCount && fsData.chunkCount > 0)) {
              try {
                const chunksSnap = await projectRef.collection("chunks").get();
                const chunkList = [];
                chunksSnap.forEach((cDoc) => {
                  const cData = cDoc.data();
                  if (cData) {
                    if (typeof cData.data === "string") {
                      chunkList.push({
                        idx: typeof cData.chunkIndex === "number" ? cData.chunkIndex : 0,
                        text: cData.data
                      });
                    } else if (cData.files) {
                      // Legacy chunk format compatibility
                      fsData.files = Object.assign(fsData.files || {}, cData.files);
                    }
                  }
                });
                if (chunkList.length > 0) {
                  chunkList.sort((a, b) => a.idx - b.idx);
                  const fullCompressed = chunkList.map(c => c.text).join("");
                  const decompressed = await this.decompressFiles(fullCompressed);
                  if (decompressed && Object.keys(decompressed).length > 0) {
                    fsData.files = decompressed;
                  }
                }
              } catch (chunkErr) {
                console.warn("[ProjectManager] Error reading Firestore chunks:", chunkErr);
              }
            } else if (fsData.compressedFiles) {
              const decompressed = await this.decompressFiles(fsData.compressedFiles);
              if (decompressed && Object.keys(decompressed).length > 0) {
                fsData.files = decompressed;
              }
            }
            
            const fsTime = Number(fsData.updatedAt) || 0;
            const candTime = candidateData ? (Number(candidateData.updatedAt) || 0) : 0;
            const isFsDefault = checkCandidateDefault(fsData);
            const isCandDefault = checkCandidateDefault(candidateData);

            // Precedence rule: custom project always takes precedence over default. Otherwise newer wins.
            let useFs = false;
            if (!candidateData) {
              useFs = true;
            } else if (isCandDefault && !isFsDefault) {
              useFs = true;
            } else if (!isCandDefault && isFsDefault) {
              useFs = false;
            } else {
              useFs = (fsTime > candTime);
            }

            if (useFs) {
              candidateData = fsData;
              candidateSource = "firestore";
            }
          }
        } catch (fsErr) {
          console.warn("[ProjectManager] Firestore project load check warning:", fsErr);
        }
      }

      if (!candidateData) {
        if (isJustLoggedIn) {
          console.log("[ProjectManager] No cloud project found for newly logged in user. Starting with clean default project.");
          this.initDefaultProject();
          await this.saveLocal(false);
          this.notifyListeners("load");
          return this.project;
        }
        return null;
      }

      let filesMap = candidateData.files;
      if (candidateData.compressedFiles && (!filesMap || Object.keys(filesMap).length <= Object.keys(DEFAULT_TEMPLATES).length)) {
        const decompressed = await this.decompressFiles(candidateData.compressedFiles);
        if (decompressed && Object.keys(decompressed).length > 0) {
          filesMap = decompressed;
        }
      }

      if (!filesMap || typeof filesMap !== "object" || Object.keys(filesMap).length === 0) {
        filesMap = { ...DEFAULT_TEMPLATES };
      }

      const cloudTime = Number(candidateData.updatedAt) || 0;
      const localTime = Number(this.project?.updatedAt) || 0;
      const isLocalDefault = this.isDefaultProject();
      const isCloudDefault = checkCandidateDefault(candidateData);

      // Precedence decisions on final load selection
      if (!force) {
        if (isLocalDefault) {
          // Local is default (lowest precedence) -> load cloud
          console.log("[ProjectManager] Local workspace is default (lowest precedence). Loading cloud project.");
        } else if (isCloudDefault) {
          // Cloud is default but local is custom -> Retain local custom project
          console.log("[ProjectManager] Cloud project is default template, but local workspace contains custom work. Retaining local.");
          return null;
        } else if (localTime > cloudTime) {
          // Both are custom -> newer wins
          console.log(`[ProjectManager] Retaining newer local project workspace (local: ${localTime} vs cloud: ${cloudTime})`);
          return null;
        }
      }

      this.project = {
        name: candidateData.name || "Override_LemLib_Bot",
        version: candidateData.version || "1.0.0",
        target: candidateData.target || "v5",
        kernel: candidateData.kernel || "4.1.0",
        lemlibVersion: candidateData.lemlibVersion || "0.5.4",
        files: filesMap,
        activeAuton: candidateData.activeAuton || "red_rush_auton",
        updatedAt: cloudTime || Date.now(),
        cloudSynced: true,
        isDefault: isCloudDefault,
      };

      if (candidateData.versions && typeof candidateData.versions === "object") {
        this.versions = candidateData.versions;
        // Enforce 50-version limit to prevent massive files in Google Drive
        for (const key in this.versions) {
          if (Array.isArray(this.versions[key])) {
            if (this.versions[key].length > 50) {
              this.versions[key].length = 50;
            }
          }
        }
        await idbPut("file_versions_history", this.versions).catch(() => {});
        this.updateVersionCountBadges();
      }

      this.markDirty(false);
      this.changedFiles.clear();
      await this.saveLocal(false);
      this.indexVariables();
      this.recordSavedBaseline();
      this.notifyListeners("load");
      console.log(`[ProjectManager] Loaded cloud project from ${candidateSource}: "${this.project.name}" (${Object.keys(filesMap).length} files)`);
      return this.project;
    }

    downloadFile(filename) {
      if (!this.project || !this.project.files || !this.project.files[filename]) return;
      const content = this.project.files[filename];
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.includes("/") ? filename.split("/").pop() : filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    downloadCompiledBinary() {
      if (!this.project) return;
      const projName = this.project.name || "robot-code";
      const binaryContent = `PROS V5 Monolithic Binary Package\nProject: ${projName}\nTarget: V5 Cortex-A9\nKernel: 4.1.0 (LemLib 0.5.4)\nTimestamp: ${Date.now()}\n[BINARY PAYLOAD -- READY FOR V5 BRAIN SLOT UPLOAD]\n`;
      const blob = new Blob([binaryContent], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projName}.hot.package.bin`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    exportProjectJson() {
      if (!this.project) return;
      const jsonStr = JSON.stringify(this.project, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${this.project.name || "Override_LemLib_Project"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // Event listener subscription
    addListener(fn) {
      if (typeof fn === "function") this.listeners.push(fn);
    }

    notifyListeners(reason = "update") {
      this.listeners.forEach(fn => {
        try { fn(this, reason); } catch (e) { console.error(e); }
      });
    }
  }

  // Singleton Instance
  global.ProjectManager = new ProjectManager();
  global.openVersionHistoryModal = function(file, verId) {
    if (global.ProjectManager) {
      global.ProjectManager.openVersionHistoryModal(file, verId);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", async (e) => {
      if (e.key === STORAGE_KEY_PROJECT && global.ProjectManager) {
        try {
          const raw = e.newValue;
          if (!raw) return;
          const parsed = JSON.parse(raw);
          const currentTimestamp = global.ProjectManager.project?.updatedAt || 0;
          const newTimestamp = parsed.updatedAt || 0;

          // Only adopt cross-tab storage change if it is strictly newer and this window is not dirty
          if (newTimestamp > currentTimestamp && !global.ProjectManager.isDirty) {
            if (parsed._idb) {
              await global.ProjectManager.initAsyncStorage();
            } else {
              global.ProjectManager.project = parsed;
              global.ProjectManager.recordSavedBaseline();
              global.ProjectManager.indexVariables();
              global.ProjectManager.notifyListeners("load");
            }
          }
        } catch (err) {
          console.warn("Storage sync event warning:", err);
        }
      }
    });
  }

  // =========================================================================
  // IMPORT LOADING SCREEN & BYTES SYNCED PROGRESS MODAL
  // =========================================================================
  const ImportProgressModal = {
    modalEl: null,

    _ensureDOM() {
      if (this.modalEl && document.body.contains(this.modalEl)) return;
      let existing = document.getElementById("importLoadingModal");
      if (existing) {
        this.modalEl = existing;
        return;
      }
      const el = document.createElement("div");
      el.id = "importLoadingModal";
      el.className = "modal-overlay import-loading-overlay";
      el.hidden = true;
      el.innerHTML = `
        <div class="import-loading-box" role="dialog" aria-modal="true" aria-labelledby="importModalTitle">
          <div class="import-loading-header">
            <div class="import-spinner-wrap">
              <div class="import-spinner-ring"></div>
              <div class="import-spinner-core">⚡</div>
            </div>
            <div class="import-header-text">
              <h3 id="importModalTitle" class="import-modal-title">Synchronizing Project Workspace</h3>
              <p id="importModalSubtitle" class="import-modal-subtitle">Processing workspace files...</p>
            </div>
          </div>

          <div class="import-sync-metric-panel">
            <div class="import-metric-header" style="display:flex;align-items:center;">
              <span class="import-metric-label">DATA SYNCHRONIZED</span>
              <span id="importEtaBadge" class="import-eta-badge" style="margin-left:auto;color:#38bdf8;font-size:0.8rem;font-weight:600;">Calculating ETA...</span>
              <span id="importPercentBadge" class="import-pct-badge" style="margin-left:8px;">0%</span>
            </div>
            <div class="import-metric-values">
              <span id="importBytesSynced" class="import-bytes-main">0 KB</span>
              <span class="import-bytes-divider">/</span>
              <span id="importBytesTotal" class="import-bytes-total">0 KB</span>
              <span id="importFileCounter" class="import-file-counter"></span>
            </div>
          </div>

          <div class="import-progress-track">
            <div id="importProgressBar" class="import-progress-bar" style="width: 0%;">
              <div class="import-progress-shimmer"></div>
            </div>
          </div>

          <div class="import-pipeline-steps">
            <div id="importStep1" class="import-step-item active">
              <span class="step-icon">⏳</span>
              <span class="step-text">Extracting & validating source files</span>
            </div>
            <div id="importStep2" class="import-step-item">
              <span class="step-icon">⚪</span>
              <span class="step-text">Indexing C++ motor/sensor devices & LemLib symbols</span>
            </div>
            <div id="importStep3" class="import-step-item">
              <span class="step-icon">⚪</span>
              <span class="step-text">Committing files to persistent IndexedDB</span>
            </div>
            <div id="importStep4" class="import-step-item">
              <span class="step-icon">⚪</span>
              <span class="step-text">Finalizing workspace & autonomous routines</span>
            </div>
          </div>

          <div class="import-current-action">
            <span id="importStatusAction" class="import-status-action">Initializing import...</span>
          </div>
        </div>
      `;
      document.body.appendChild(el);
      this.modalEl = el;
    },

    show(opts = {}) {
      const {
        title = "Synchronizing Project Workspace",
        subtitle = "Processing workspace files...",
        totalBytes = 0,
        totalFiles = 0
      } = opts;

      this._ensureDOM();
      const titleEl = document.getElementById("importModalTitle");
      const subtitleEl = document.getElementById("importModalSubtitle");
      const bytesSyncedEl = document.getElementById("importBytesSynced");
      const bytesTotalEl = document.getElementById("importBytesTotal");
      const pctBadge = document.getElementById("importPercentBadge");
      const progressBar = document.getElementById("importProgressBar");
      const statusAction = document.getElementById("importStatusAction");
      const fileCounter = document.getElementById("importFileCounter");

      const formatFn = (global.ProjectManager && global.ProjectManager.formatBytes) ? 
        (b) => global.ProjectManager.formatBytes(b) : 
        (b) => `${(b / 1024).toFixed(1)} KB`;

      this._startTime = Date.now();
      if (titleEl) titleEl.textContent = title;
      if (subtitleEl) subtitleEl.textContent = subtitle;
      if (bytesSyncedEl) bytesSyncedEl.textContent = "0 B";
      if (bytesTotalEl) bytesTotalEl.textContent = totalBytes > 0 ? formatFn(totalBytes) : "0 B";
      if (pctBadge) pctBadge.textContent = "0%";
      const etaBadge = document.getElementById("importEtaBadge");
      if (etaBadge) etaBadge.textContent = "Calculating ETA...";
      if (progressBar) progressBar.style.width = "0%";
      if (statusAction) statusAction.textContent = "Preparing files for synchronization...";
      if (fileCounter) fileCounter.textContent = totalFiles ? `(${totalFiles} files)` : "";

      this._setStep(1, "active");
      this._setStep(2, "");
      this._setStep(3, "");
      this._setStep(4, "");

      this.modalEl.hidden = false;
      this.modalEl.classList.add("open");
    },

    _setStep(stepNum, state) {
      const el = document.getElementById(`importStep${stepNum}`);
      if (!el) return;
      el.className = `import-step-item ${state}`.trim();
      const icon = el.querySelector(".step-icon");
      if (icon) {
        if (state === "done") icon.textContent = "✓";
        else if (state === "active") icon.textContent = "⏳";
        else icon.textContent = "⚪";
      }
    },

    update(opts = {}) {
      const {
        phase = 1,
        pct = 0,
        currentBytes = 0,
        totalBytes = 0,
        message = "",
        currentFile = ""
      } = opts;

      this._ensureDOM();
      const bytesSyncedEl = document.getElementById("importBytesSynced");
      const bytesTotalEl = document.getElementById("importBytesTotal");
      const pctBadge = document.getElementById("importPercentBadge");
      const progressBar = document.getElementById("importProgressBar");
      const statusAction = document.getElementById("importStatusAction");

      const clampedPct = Math.min(100, Math.max(0, Math.round(pct)));
      if (progressBar) progressBar.style.width = `${clampedPct}%`;
      if (pctBadge) pctBadge.textContent = `${clampedPct}%`;

      const etaBadge = document.getElementById("importEtaBadge");
      if (etaBadge && this._startTime && clampedPct > 2 && clampedPct < 100) {
        const elapsedSec = (Date.now() - this._startTime) / 1000;
        const totalEstSec = elapsedSec / (clampedPct / 100);
        const remainingSec = Math.max(1, Math.round(totalEstSec - elapsedSec));
        if (remainingSec < 60) {
          etaBadge.textContent = `⏱️ ~${remainingSec}s remaining`;
        } else {
          etaBadge.textContent = `⏱️ ~${Math.ceil(remainingSec / 60)}m remaining`;
        }
      } else if (etaBadge && clampedPct >= 100) {
        etaBadge.textContent = "⚡ Done!";
      }

      const formatFn = (global.ProjectManager && global.ProjectManager.formatBytes) ? 
        (b) => global.ProjectManager.formatBytes(b) : 
        (b) => `${(b / 1024).toFixed(1)} KB`;

      if (bytesSyncedEl) bytesSyncedEl.textContent = formatFn(currentBytes);
      if (bytesTotalEl && totalBytes > 0) bytesTotalEl.textContent = formatFn(totalBytes);

      if (message && statusAction) {
        statusAction.textContent = currentFile ? `${message} (${currentFile})` : message;
      }

      if (phase === 1) {
        this._setStep(1, "active");
      } else if (phase > 1) {
        this._setStep(1, "done");
      }

      if (phase === 2) {
        this._setStep(2, "active");
      } else if (phase > 2) {
        this._setStep(2, "done");
      }

      if (phase === 3) {
        this._setStep(3, "active");
      } else if (phase > 3) {
        this._setStep(3, "done");
      }

      if (phase === 4) {
        this._setStep(4, "active");
      }
    },

    finish(opts = {}) {
      const {
        bytesSynced = 0,
        totalBytes = 0,
        message = "✓ Synchronization complete!"
      } = opts;

      this._ensureDOM();
      const finalBytes = Math.max(bytesSynced, totalBytes);
      this.update({
        phase: 4,
        pct: 100,
        currentBytes: finalBytes,
        totalBytes: finalBytes,
        message: message
      });
      this._setStep(1, "done");
      this._setStep(2, "done");
      this._setStep(3, "done");
      this._setStep(4, "done");

      const titleEl = document.getElementById("importModalTitle");
      if (titleEl) titleEl.textContent = "Workspace Synchronized!";

      setTimeout(() => {
        this.hide();
      }, 750);
    },

    hide() {
      if (this.modalEl) {
        this.modalEl.classList.remove("open");
        this.modalEl.hidden = true;
      }
    }
  };

  global.ImportProgressModal = ImportProgressModal;

  // Helper for Security Challenge Modal before project wiping
  global.promptWipeChallenge = function(targetName, onConfirmed) {
    const modal = document.getElementById("wipeChallengeModal");
    if (!modal) {
      if (confirm(`⚠️ Warning: Importing will wipe your current project workspace. Proceed?`)) {
        onConfirmed();
      }
      return;
    }

    const currentNameEl = document.getElementById("wipeCurrentProjectName");
    const targetNameEl = document.getElementById("wipeTargetProjectName");
    const displayEl = document.getElementById("wipeChallengeDisplay");
    const inputEl = document.getElementById("wipeChallengeInput");
    const errorEl = document.getElementById("wipeChallengeError");
    const btnConfirm = document.getElementById("btnWipeConfirmAction");
    const btnRefresh = document.getElementById("btnRefreshWipeChallenge");
    const btnBackup = document.getElementById("btnWipeBackupFirst");
    const btnCancel = document.getElementById("btnWipeChallengeCancel");
    const btnAbort = document.getElementById("btnWipeChallengeAbort");

    if (currentNameEl) {
      const curProjName = (global.ProjectManager && global.ProjectManager.project && global.ProjectManager.project.name) || "Current Project";
      currentNameEl.textContent = curProjName;
    }
    if (targetNameEl) {
      targetNameEl.textContent = targetName || "New Project Bundle";
    }

    let code = "WIPE-" + Math.floor(1000 + Math.random() * 9000);
    if (displayEl) displayEl.textContent = code;

    if (inputEl) {
      inputEl.value = "";
      inputEl.style.borderColor = "#475569";
    }
    if (errorEl) errorEl.style.display = "none";
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.style.opacity = "0.5";
      btnConfirm.style.cursor = "not-allowed";
    }

    const closeModal = () => {
      modal.hidden = true;
      modal.classList.remove("open");
    };

    const generateNewCode = () => {
      code = "WIPE-" + Math.floor(1000 + Math.random() * 9000);
      if (displayEl) displayEl.textContent = code;
      if (inputEl) {
        inputEl.value = "";
        inputEl.focus();
      }
      if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.style.opacity = "0.5";
        btnConfirm.style.cursor = "not-allowed";
      }
      if (errorEl) errorEl.style.display = "none";
    };

    if (btnRefresh) btnRefresh.onclick = generateNewCode;

    if (inputEl) {
      inputEl.oninput = () => {
        const val = inputEl.value.trim().toUpperCase();
        if (val === code) {
          if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.style.opacity = "1";
            btnConfirm.style.cursor = "pointer";
          }
          if (errorEl) errorEl.style.display = "none";
          inputEl.style.borderColor = "#22c55e";
        } else {
          if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.style.opacity = "0.5";
            btnConfirm.style.cursor = "not-allowed";
          }
          inputEl.style.borderColor = "#475569";
        }
      };
    }

    if (btnBackup) {
      btnBackup.onclick = () => {
        if (global.ProjectManager) {
          global.ProjectManager.exportProjectZip();
        }
      };
    }

    if (btnCancel) btnCancel.onclick = closeModal;
    if (btnAbort) btnAbort.onclick = closeModal;

    if (btnConfirm) {
      btnConfirm.onclick = () => {
        const val = inputEl ? inputEl.value.trim().toUpperCase() : "";
        if (val !== code) {
          if (errorEl) errorEl.style.display = "block";
          return;
        }
        closeModal();
        if (typeof onConfirmed === "function") {
          onConfirmed();
        }
      };
    }

    modal.hidden = false;
    modal.classList.add("open");
    setTimeout(() => {
      if (inputEl) inputEl.focus();
    }, 100);
  };
})(typeof window !== "undefined" ? window : global);
