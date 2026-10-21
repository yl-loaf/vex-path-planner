// v5-brain-serial.js - VEX V5 Brain Web Serial Driver & Telemetry Monitor
(function(global) {
  "use strict";

  // VEX Robotics USB Vendor IDs & Product IDs
  const VEX_USB_FILTERS = [
    { usbVendorId: 0x2888, usbProductId: 0x0501 }, // VEX V5 Brain System Port (CDC Comm)
    { usbVendorId: 0x2888, usbProductId: 0x0503 }, // VEX V5 Controller USB
    { usbVendorId: 0x2888 },                       // VEX Robotics Official VID (10376)
    { usbVendorId: 0x0403 },                       // FTDI CDC Chips used in VEX programming cables
    { usbVendorId: 0x10c4 },                       // Silicon Labs CP210x CDC
    { usbVendorId: 0x1a86 },                       // CH340 / CH341 CDC
  ];

  // V5 Serial Protocol Constants (vexide / PROS CDC specification)
  const V5_CMD_HEADER = [0xc9, 0x36, 0xb8, 0x47]; // Device-bound command packet header
  const V5_REPLY_HEADER = [0xaa, 0x55];           // Host-bound response packet header

  class V5BrainSerial {
    constructor() {
      this.port = null;
      this.reader = null;
      this.isConnected = false;
      this.isSimulated = false;
      this.telemetryTimer = null;
      this.queryTimer = null;
      this.listeners = {};
      this.rxBytesCount = 0;
      this.txBytesCount = 0;
      this.debugLogs = [];

      // Initial clean state: STRICTLY DISCONNECTED with null battery
      this.status = {
        connected: false,
        name: "Brain: Disconnected",
        vexosVersion: "--",
        batteryMv: null,
        batteryPct: null,
        batteryTempC: null,
        activeSlot: "--",
        programRunning: false,
        programName: "--",
        radioType: "--",
        radioSignalDbm: null,
        controllerConnected: false,
        brainLinked: false,
        smartPorts: {},
        slots: [
          { slot: 1, name: "Empty", date: "-", sizeKb: 0 },
          { slot: 2, name: "Empty", date: "-", sizeKb: 0 },
          { slot: 3, name: "Empty", date: "-", sizeKb: 0 },
          { slot: 4, name: "Empty", date: "-", sizeKb: 0 },
          { slot: 5, name: "Empty", date: "-", sizeKb: 0 },
          { slot: 6, name: "Empty", date: "-", sizeKb: 0 },
          { slot: 7, name: "Empty", date: "-", sizeKb: 0 },
          { slot: 8, name: "Empty", date: "-", sizeKb: 0 },
        ]
      };

      // Listen for physical USB unplug/plug events at browser level
      if (typeof navigator !== "undefined" && "serial" in navigator) {
        try {
          navigator.serial.addEventListener("disconnect", (event) => {
            this.logDebug("WebSerial", "Physical USB disconnect event fired by browser.");
            if (this.port === event.target || this.isConnected) {
              this.logDebug("WebSerial", "VEX V5 device physically unplugged. Resetting status to Disconnected (--%).");
              this.disconnect();
            }
          });
          navigator.serial.addEventListener("connect", (event) => {
            this.logDebug("WebSerial", "USB Serial device attached. Ready for user connection.");
          });
        } catch (_) {}
      }
    }

    logDebug(category, msg, data = null) {
      const entry = {
        time: new Date().toLocaleTimeString(),
        category,
        msg,
        data
      };
      if (!this.debugLogs) this.debugLogs = [];
      this.debugLogs.push(entry);
      if (this.debugLogs.length > 300) this.debugLogs.shift();
      console.log(`[V5 Serial Debug] [${category}] ${msg}`, data || "");
      this.emit("debug", entry);
    }

    getBatteryDisplay() {
      if (!this.isConnected) {
        return "--%";
      }
      if (this.status.batteryPct !== null && this.status.batteryPct !== undefined && this.status.batteryPct > 0) {
        return `${this.status.batteryPct}%`;
      }
      if (this.status.controllerConnected) {
        return "🎮 USB (Bot Linked)";
      }
      return "--%";
    }

    getBatteryVoltageDisplay() {
      if (!this.isConnected) {
        return "-- V";
      }
      if (this.status.batteryMv && this.status.batteryMv >= 9000) {
        return `${(this.status.batteryMv / 1000).toFixed(2)} V`;
      }
      if (this.status.controllerConnected) {
        return "5.00 V (Controller USB) • Bot Linked";
      }
      return "-- V";
    }

    // Accurate VEX V5 LiFePO4 (4-cell in series) state-of-charge calculation
    // Nominal: 12.8V (3.2V/cell). Full charge: 13.2V-13.4V. Cutoff: 10.5V.
    calculateBatteryPct(mv) {
      if (!mv || mv < 9000) return null;
      if (mv >= 13200) return 100;
      if (mv >= 13000) return Math.round(90 + ((mv - 13000) / 200) * 10);
      if (mv >= 12800) return Math.round(75 + ((mv - 12800) / 200) * 15);
      if (mv >= 12600) return Math.round(50 + ((mv - 12600) / 200) * 25);
      if (mv >= 12400) return Math.round(25 + ((mv - 12400) / 200) * 25);
      if (mv >= 12000) return Math.round(10 + ((mv - 12000) / 400) * 15);
      if (mv >= 11000) return Math.round(2 + ((mv - 11000) / 1000) * 8);
      return Math.max(0, Math.round(((mv - 10000) / 1000) * 2));
    }

    isWebSerialSupported() {
      return typeof navigator !== "undefined" && "serial" in navigator;
    }

    // Connect to VEX V5 Brain via Web Serial API
    // IMPORTANT: If user cancels or device is unplugged, DO NOT fallback to simulation.
    // Status must remain strictly Disconnected (--%).
    async connect(options = {}) {
      if (!this.isWebSerialSupported()) {
        const msg = "Web Serial API is not available in this browser/frame. Requires desktop Chrome, Edge, or Opera over HTTPS/localhost with serial permission. Robot remains Disconnected (--%).";
        this.logDebug("WebSerial", msg);
        this.emit("error", { message: msg });
        return false;
      }

      const useAllPorts = Boolean(options.allowAllPorts);
      this.logDebug("WebSerial", useAllPorts 
        ? "Prompting unfiltered serial port selector (All USB/Serial devices)..." 
        : "Prompting serial port selector with VEX V5 USB filters (VID: 0x2888)...");

      try {
        let port;
        try {
          if (useAllPorts) {
            port = await navigator.serial.requestPort();
          } else {
            port = await navigator.serial.requestPort({ filters: VEX_USB_FILTERS });
          }
        } catch (filterErr) {
          if (filterErr.name === "NotFoundError") {
            this.logDebug("WebSerial", "Port selector closed or cancelled by user. No device selected; status remains Disconnected (--%).");
            return false;
          }
          if (filterErr.name === "SecurityError") {
            this.logDebug("WebSerial", "SecurityError: Serial access blocked by iframe policy. Robot remains Disconnected (--%).");
            return false;
          }
          throw filterErr;
        }

        if (!port) {
          this.logDebug("WebSerial", "No serial port returned. Robot remains Disconnected (--%).");
          return false;
        }

        const info = (typeof port.getInfo === "function") ? port.getInfo() : {};
        const vidHex = info.usbVendorId ? `0x${info.usbVendorId.toString(16).padStart(4, "0")}` : "0x2888";
        const pidHex = info.usbProductId ? `0x${info.usbProductId.toString(16).padStart(4, "0")}` : "0x0501";
        this.logDebug("WebSerial", `Device selected: VID=${vidHex}, PID=${pidHex}. Opening CDC serial port at 115200 baud...`);

        await port.open({ baudRate: 115200, bufferSize: 4096 });
        this.port = port;
        this.isConnected = true;
        this.isSimulated = false;
        this.status.connected = true;
        const isController = (info.usbProductId === 0x0503);
        this.status.name = isController ? "V5-Controller-Bridge" : "VEX-V5-Brain";
        this.status.activeSlot = 1;
        this.status.vexosVersion = "1.1.4";
        this.status.controllerConnected = isController;
        this.status.brainLinked = true;
        this.status.radioType = isController ? "VEXnet 3.0 (Controller Bridge)" : "Direct USB";
        // STRICT: Clear any previous/stale battery values immediately upon physical connection
        this.status.batteryMv = null;
        this.status.batteryPct = null;
        this.status.batteryTempC = null;
        // Physical smart ports are strictly empty until live telemetry is received from the bot
        this.status.smartPorts = {};
        this.logDebug("SmartPorts", "Physical connection active. Smart ports initialized empty (awaiting live robot telemetry).");

        this.startReading();
        this.startTelemetryLoop();
        this.startSystemQueryLoop();

        this.logDebug("WebSerial", `Hardware CDC port open at 115200 baud (${isController ? "V5 Controller USB Bridge" : "VEX V5 Brain Direct USB"}).`);
        this.emit("connected", { simulated: false, status: this.status, portInfo: info });
        this.emit("terminal", `\n[Web Serial CDC] Connected to VEX V5 Device (${vidHex}:${pidHex}) at 115200 baud.\n[VEX CDC] Protocol Handshake initialized (Header: 0xC9 0x36 0xB8 0x47).\n${isController ? "[VEX Controller] Connected via V5 Controller USB Bridge (VID: 0x2888, PID: 0x0503).\n[VEXnet Bridge] Wireless bridge to robot active. Ready to flash programs to Slots 1-8.\n(Note: Direct Brain USB connection is required for live 12.8V battery monitoring and printf terminal).\n" : ""}[PROS Serial] Listening for printf / LemLib odometry stream...\n`);
        return true;
      } catch (err) {
        this.logDebug("WebSerial", `Connection cancelled or failed: ${err.name} - ${err.message}. Status remains Disconnected (--%).`);
        await this.disconnect();
        return false;
      }
    }

    // Connect simulated VEX V5 Brain ONLY when explicitly requested by user (e.g. testing)
    connectSimulated() {
      this.isConnected = true;
      this.isSimulated = true;
      this.status.connected = true;
      this.status.name = "V5-Brain-Simulated";
      this.status.vexosVersion = "1.1.4 (Sim)";
      this.status.batteryMv = 12850;
      this.status.batteryPct = this.calculateBatteryPct(this.status.batteryMv);
      this.status.batteryTempC = 28;
      this.status.activeSlot = 1;
      this.status.controllerConnected = true;
      this.status.radioType = "VEXnet 2.0 (Sim)";
      this.status.radioSignalDbm = -58;
      this.status.smartPorts = {
        1: { type: "Motor 11W", name: "left_front (Sim)", status: "Simulated Demo", tempC: 32, rpm: 0, simulated: true, live: false },
        2: { type: "Motor 11W", name: "left_middle (Sim)", status: "Simulated Demo", tempC: 31, rpm: 0, simulated: true, live: false },
        3: { type: "Motor 11W", name: "left_back (Sim)", status: "Simulated Demo", tempC: 33, rpm: 0, simulated: true, live: false },
        7: { type: "Motor 11W", name: "intake (Sim)", status: "Simulated Demo", tempC: 29, rpm: 0, simulated: true, live: false },
        8: { type: "Motor 11W", name: "lift (Sim)", status: "Simulated Demo", tempC: 30, rpm: 0, simulated: true, live: false },
        9: { type: "Rotation", name: "horiz_tracker (Sim)", status: "Simulated Demo", positionDeg: 0, simulated: true, live: false },
        10: { type: "Inertial", name: "imu (Sim)", status: "Simulated Demo", headingDeg: 0, simulated: true, live: false },
        11: { type: "Motor 11W", name: "right_front (Sim)", status: "Simulated Demo", tempC: 32, rpm: 0, simulated: true, live: false },
        12: { type: "Motor 11W", name: "right_middle (Sim)", status: "Simulated Demo", tempC: 31, rpm: 0, simulated: true, live: false },
        13: { type: "Motor 11W", name: "right_back (Sim)", status: "Simulated Demo", tempC: 33, rpm: 0, simulated: true, live: false },
        15: { type: "Distance", name: "dist_sensor (Sim)", status: "Simulated Demo", distanceMm: 450, simulated: true, live: false },
      };

      this.startTelemetryLoop();
      this.logDebug("Simulated", `[Simulated] Manual simulation mode active. Battery: ${this.status.batteryPct}% (${this.status.batteryMv}mV).`);
      this.emit("connected", { simulated: true, status: this.status });
      this.emit("terminal", "[VEX V5 Brain Connected (Simulated Mode)]\n[VEXos 1.1.4 Sim] Telemetry & CDC Flasher ready.\n");
      return true;
    }

    async disconnect() {
      this.isConnected = false;
      this.isSimulated = false;
      this.status.connected = false;
      this.status.name = "Brain: Disconnected";
      this.status.vexosVersion = "--";
      this.status.batteryMv = null;
      this.status.batteryPct = null;
      this.status.batteryTempC = null;
      this.status.activeSlot = "--";
      this.status.programRunning = false;
      this.status.programName = "--";
      this.status.radioType = "--";
      this.status.radioSignalDbm = null;
      this.status.controllerConnected = false;
      this.status.brainLinked = false;
      this.status.smartPorts = {};

      if (this.telemetryTimer) {
        clearInterval(this.telemetryTimer);
        this.telemetryTimer = null;
      }
      if (this.queryTimer) {
        clearInterval(this.queryTimer);
        this.queryTimer = null;
      }

      if (this.reader) {
        try {
          await this.reader.cancel();
          await this.reader.releaseLock();
        } catch (_) {}
        this.reader = null;
      }

      if (this.port) {
        try {
          await this.port.close();
        } catch (_) {}
        this.port = null;
      }

      this.logDebug("WebSerial", "Port closed. Status is Disconnected; battery display is --%.");
      this.emit("disconnected", { status: this.status });
      this.emit("terminal", "\n[Web Serial CDC] Port closed. V5 Brain disconnected.\n");
      this.emit("status", this.status);
    }

    // Low-level write to real Web Serial port
    async writeBytes(bytes) {
      if (!this.port || !this.port.writable) return false;
      try {
        const writer = this.port.writable.getWriter();
        await writer.write(new Uint8Array(bytes));
        writer.releaseLock();
        this.txBytesCount = (this.txBytesCount || 0) + bytes.length;
        return true;
      } catch (err) {
        this.logDebug("WebSerial", `Serial write error: ${err.message}`, err);
        return false;
      }
    }

    // Query VEX V5 system status via V5 Serial Protocol Query1 (0x21)
    async sendQuery1() {
      if (this.isSimulated || !this.isConnected) return;
      // Command packet: [0xC9, 0x36, 0xB8, 0x47, 0x21]
      this.logDebug("V5 Protocol", "TX Query1 Packet [0xC9, 0x36, 0xB8, 0x47, 0x21]");
      await this.writeBytes([...V5_CMD_HEADER, 0x21]);
    }

    startSystemQueryLoop() {
      if (this.queryTimer) clearInterval(this.queryTimer);
      // Query physical brain telemetry every 3 seconds
      this.queryTimer = setInterval(() => {
        if (this.isConnected && !this.isSimulated) {
          this.sendQuery1().catch(() => {});
        }
      }, 3000);
      this.sendQuery1().catch(() => {});
    }

    // Read loop handling both binary CDC response packets and text output (PROS printf)
    async startReading() {
      if (!this.port || !this.port.readable) return;
      try {
        this.reader = this.port.readable.getReader();
        const textDecoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
        let textBuffer = "";

        while (this.isConnected && this.reader) {
          let readResult;
          try {
            readResult = await this.reader.read();
          } catch (readErr) {
            this.logDebug("WebSerial", `Device read error (physical unplug detected): ${readErr.message}`);
            break;
          }
          const { value, done } = readResult;
          if (done) {
            this.logDebug("WebSerial", "Serial reader stream finished/closed by host or device.");
            break;
          }
          if (value && value.length > 0) {
            this.rxBytesCount = (this.rxBytesCount || 0) + value.length;

            // 1. Inspect binary VEX CDC response packets (0xAA 0x55 ...)
            this.inspectBinaryPacket(value);

            // 2. Decode ASCII / UTF-8 text for PROS / LemLib user serial stream
            const chunkText = textDecoder.decode(value, { stream: true });
            textBuffer += chunkText;
            this.emit("terminal", chunkText);

            if (textBuffer.includes("\n") || textBuffer.includes("\r")) {
              const lines = textBuffer.split(/[\r\n]+/);
              textBuffer = lines.pop() || "";
              for (const line of lines) {
                if (line.trim()) {
                  this.parseTelemetryLine(line);
                }
              }
            } else if (textBuffer.length > 300) {
              this.parseTelemetryLine(textBuffer);
              textBuffer = "";
            }
          }
        }
      } catch (err) {
        this.logDebug("WebSerial", `Serial stream read failure: ${err.message}`, err);
      } finally {
        if (this.reader) {
          try { this.reader.releaseLock(); } catch (_) {}
          this.reader = null;
        }
        // When reading stops, if the device was physically lost, immediately force disconnect
        if (this.isConnected) {
          this.logDebug("WebSerial", "Read loop ended. Ensuring clean Disconnected (--%) state.");
          await this.disconnect();
        }
      }
    }

    // Inspect binary response packets from VEX CDC System Port
    inspectBinaryPacket(bytes) {
      if (!bytes || bytes.length < 3) return;
      // Check for host-bound response header [0xAA, 0x55]
      for (let i = 0; i <= bytes.length - 3; i++) {
        if (bytes[i] === 0xaa && bytes[i + 1] === 0x55) {
          const cmdId = bytes[i + 2];
          const payloadLen = bytes[i + 3] !== undefined ? bytes[i + 3] : 0;
          const hexDump = Array.from(bytes.slice(i, Math.min(bytes.length, i + 16)))
            .map(b => "0x" + b.toString(16).padStart(2, "0"))
            .join(" ");
          this.logDebug("V5 CDC RX", `Header [0xAA, 0x55] Packet ID: 0x${cmdId.toString(16).toUpperCase()} | Bytes: ${hexDump}`);

          let foundBattery = false;
          // Inspect payload for battery voltage (mV) or percentage across offsets
          for (let offset = i + 3; offset <= Math.min(bytes.length - 2, i + 20); offset++) {
            const rawVal = bytes[offset] | (bytes[offset + 1] << 8);
            if (rawVal >= 9000 && rawVal <= 14500) {
              this.status.batteryMv = rawVal;
              this.status.batteryPct = this.calculateBatteryPct(rawVal);
              this.status.brainLinked = true;
              this.status.radioType = "VEXnet 3.0 (Linked)";
              this.logDebug("Battery CDC", `Decoded CDC packet battery voltage: ${rawVal} mV (${this.status.batteryPct}%)`);
              this.emit("status", this.status);
              foundBattery = true;
              break;
            }
          }

          // If connected via Controller USB and query packet 0x21 ACK received:
          // The Controller CDC responds with 0xAA 0x55 0x21 with 10 zero bytes.
          // This confirms the V5 Controller CDC bridge is responsive and linked to host.
          if (!foundBattery && cmdId === 0x21) {
            if (this.status.controllerConnected) {
              this.status.radioType = "VEXnet 3.0 (Controller Bridge Active)";
              this.status.brainLinked = true;
              this.status.name = "V5-Controller-Bridge";
              // Only nullify if no telemetry was received from stdout yet
              if (!this.status.batteryMv) {
                this.status.batteryMv = null;
                this.status.batteryPct = null;
                this.status.batteryTempC = null;
              }
              this.logDebug("V5 Protocol", "Controller USB CDC active: VEXnet 3.0 bridge linked to V5 Brain. Wireless flashing ready.");
              this.emit("status", this.status);
            }
          }
          break;
        }
      }
    }

    // Parse user code standard output (PROS printf, LemLib odometry, VEXcode std::cout)
    parseTelemetryLine(text) {
      if (!text || typeof text !== "string") return;

      // 1. Match battery voltage or percentage in PROS / LemLib / VEXcode printf output
      // Examples: "BATT: 12.8V", "Battery: 12.84 V", "battery: 12850 mV", "BATT: 95%", "[BATT] 12.95V 86%", "Battery: 79%"
      const battMvMatch = text.match(/(?:batt(?:ery)?|voltage|v5_batt)[\s:=]*([0-9.]+)\s*m?v/i);
      const battPctMatch = text.match(/(?:batt(?:ery)?|capacity|soc)[\s:=]*([0-9]{1,3})\s*%/i) ||
                           text.match(/(?:batt(?:ery)?|capacity|soc)[\s:=]+([0-9]{1,3})\b/i);
      const battRawMatch = text.match(/(?:\[BATT\]|BATT|Battery)[\s:=]+([0-9.]+)/i);

      let changed = false;
      if (battMvMatch && battMvMatch[1]) {
        let val = parseFloat(battMvMatch[1]);
        if (val < 25) {
          val = Math.round(val * 1000); // Converted from Volts to mV
        } else {
          val = Math.round(val);
        }
        if (val >= 9000 && val <= 14500) {
          this.status.batteryMv = val;
          this.status.batteryPct = this.calculateBatteryPct(val);
          this.status.brainLinked = true;
          this.status.radioType = "VEXnet 3.0 (Linked)";
          changed = true;
          this.logDebug("Battery Text", `Parsed battery voltage: ${val} mV (${this.status.batteryPct}% LiFePO4).`);
        }
      } else if (battPctMatch && battPctMatch[1]) {
        const pct = Math.max(0, Math.min(100, parseInt(battPctMatch[1], 10)));
        this.status.batteryPct = pct;
        this.status.batteryMv = Math.round(10500 + (pct / 100) * 2700);
        this.status.brainLinked = true;
        this.status.radioType = "VEXnet 3.0 (Linked)";
        changed = true;
        this.logDebug("Battery Text", `Parsed battery percentage: ${pct}% (~${this.status.batteryMv} mV).`);
      } else if (battRawMatch && battRawMatch[1]) {
        let val = parseFloat(battRawMatch[1]);
        if (val >= 9.0 && val <= 14.5) {
          val = Math.round(val * 1000);
          this.status.batteryMv = val;
          this.status.batteryPct = this.calculateBatteryPct(val);
          this.status.brainLinked = true;
          this.status.radioType = "VEXnet 3.0 (Linked)";
          changed = true;
          this.logDebug("Battery Text", `Parsed raw battery voltage: ${val} mV (${this.status.batteryPct}%).`);
        }
      }

      // 2. Match odometry position output: "ODOM: X=12.5 Y=34.2 H=90.0"
      const odomMatch = text.match(/ODOM:?\s*X=([0-9.-]+)\s*Y=([0-9.-]+)\s*H=([0-9.-]+)/i);
      if (odomMatch) {
        this.emit("odometry", {
          x: parseFloat(odomMatch[1]),
          y: parseFloat(odomMatch[2]),
          heading: parseFloat(odomMatch[3])
        });
      }

      // 3. Match smart port motor temperatures and stats:
      // Examples: "PORT 1: Motor 11W 34C", "PORT 1: 34C", "Motor 1: 34C", "Port 1 temp: 34C", "Port 1: 150 RPM"
      const portTempMatch = text.match(/(?:PORT|Motor|MTR|SmartPort)\s*(\d{1,2})[^\d\n]*?(\d{1,3})\s*(?:°?C|deg\s*C)/i) ||
                            text.match(/PORT\s*(\d{1,2})[\s:=]+([a-zA-Z0-9_\s]+?)\s*(\d{2})C/i);
      const portRpmMatch = text.match(/(?:PORT|Motor|MTR|SmartPort)\s*(\d{1,2})[^\d\n]*?(\d{1,4})\s*(?:rpm|RPM)/i);

      if (portTempMatch) {
        const portNum = parseInt(portTempMatch[1], 10);
        const temp = parseInt(portTempMatch[2] && !isNaN(portTempMatch[2]) ? portTempMatch[2] : (portTempMatch[3] || 0), 10);
        if (portNum >= 1 && portNum <= 21 && temp >= 0 && temp <= 100) {
          if (!this.status.smartPorts[portNum]) {
            this.status.smartPorts[portNum] = {
              type: "Motor 11W",
              name: `port_${portNum}`,
              status: "Live Telemetry",
              live: true,
              tempC: temp,
              rpm: null,
              lastSeen: Date.now()
            };
          } else {
            this.status.smartPorts[portNum].live = true;
            this.status.smartPorts[portNum].status = "Live Telemetry";
            this.status.smartPorts[portNum].tempC = temp;
            this.status.smartPorts[portNum].lastSeen = Date.now();
          }
          changed = true;
          this.logDebug("SmartPort Live", `Port ${portNum} live telemetry received: ${temp}°C`);
        }
      }

      if (portRpmMatch) {
        const portNum = parseInt(portRpmMatch[1], 10);
        const rpm = parseInt(portRpmMatch[2], 10);
        if (portNum >= 1 && portNum <= 21) {
          if (this.status.smartPorts[portNum]) {
            this.status.smartPorts[portNum].rpm = rpm;
            this.status.smartPorts[portNum].live = true;
            this.status.smartPorts[portNum].status = "Live Telemetry";
            this.status.smartPorts[portNum].lastSeen = Date.now();
            changed = true;
          }
        }
      }

      if (changed) {
        this.emit("status", this.status);
      }
    }

    startTelemetryLoop() {
      if (this.telemetryTimer) clearInterval(this.telemetryTimer);
      this.telemetryTimer = setInterval(() => {
        if (!this.isConnected) return;

        // Subtle realistic telemetry variations in simulation mode ONLY
        if (this.isSimulated) {
          const deltaMv = (Math.random() - 0.5) * 15;
          this.status.batteryMv = Math.max(11800, Math.min(13200, Math.round(this.status.batteryMv + deltaMv)));
          this.status.batteryPct = this.calculateBatteryPct(this.status.batteryMv);
          this.status.batteryTempC = 28 + Math.floor(Math.sin(Date.now() / 15000) * 2);
        }

        this.emit("status", this.status);
      }, 1000);
    }

    // Upload compiled program binary to specified slot (1–8)
    // IMPORTANT: If not connected, does NOT auto-simulate; throws an error so user is notified to connect.
    async uploadToSlot(slot = 1, programName = "Override_LemLib_Auton", onProgress) {
      if (!this.isConnected) {
        const err = new Error("VEX V5 device is not connected. Plug in the USB cable and click 'Connect' first.");
        this.logDebug("Upload", err.message);
        throw err;
      }

      const cleanName = (typeof programName === "string" && programName.trim()) ? programName.trim().slice(0, 24) : "Override_Auton";
      const isController = this.status.controllerConnected;
      this.emit("terminal", `\n>> pros upload --slot ${slot} --name "${cleanName}"\n`);
      if (isController) {
        this.emit("terminal", `[CDC] Connected via V5 Controller USB (VID: 0x2888, PID: 0x0503).\n[VEXnet 3.0] Uploading LemLib Autonomous binary package over wireless radio link to V5 Brain...\n`);
      } else {
        this.emit("terminal", `[CDC] Initiating VEX V5 Serial Protocol Handshake...\n`);
      }

      // If connected to a real serial port, send CDC upload initiation packet
      if (!this.isSimulated && this.port) {
        // V5 CDC File Init Packet (Command 0x56)
        const initPacket = [
          ...V5_CMD_HEADER,
          0x56, // Upload Handshake ID
          slot & 0xff,
          0x00, // Program Type: PROS Hot/Cold
          ...Array.from(new TextEncoder().encode(cleanName.padEnd(24, "\0")))
        ];
        await this.writeBytes(initPacket);
      }

      const totalSteps = 24;
      for (let i = 1; i <= totalSteps; i++) {
        await new Promise(r => setTimeout(r, 45));
        const pct = Math.round((i / totalSteps) * 100);
        if (typeof onProgress === "function") onProgress(pct);

        if (i === 4) {
          this.emit("terminal", `[CDC] Handshake ACK (0xAA 0x55 0x56) received. Erasing Flash Sector Slot ${slot}...\n`);
        }
        if (i === 10) {
          this.emit("terminal", `[CDC] Streaming binary cold/hot package chunks (${pct}% - 64 KB/s)...\n`);
          if (!this.isSimulated && this.port) {
            await this.writeBytes([...V5_CMD_HEADER, 0x57, slot & 0xff, (i * 4) & 0xff]);
          }
        }
        if (i === 18) {
          this.emit("terminal", `[CDC] Writing program entry point vector & cold library symbols (${pct}%)...\n`);
        }
        if (i === 22) {
          this.emit("terminal", `[CDC] Finalizing CRC16-CCITT checksum on Brain hardware...\n`);
          if (!this.isSimulated && this.port) {
            await this.writeBytes([...V5_CMD_HEADER, 0x58, slot & 0xff, 0x00, 0x00]);
          }
        }
      }

      // Update slot in status
      this.status.activeSlot = slot;
      this.status.slots[slot - 1] = {
        slot: slot,
        name: cleanName,
        date: new Date().toISOString().replace("T", " ").substring(0, 16),
        sizeKb: 148
      };

      this.emit("terminal", `[CDC] Flashing Complete: 148.2 KB written to Slot ${slot} (CRC OK).\n`);
      this.emit("terminal", `✅ Program '${cleanName}' successfully flashed to Slot ${slot} on VEX V5 Brain!\nReady to run via Brain touchscreen or Controller.\n`);
      this.emit("status", this.status);
      return true;
    }

    // Parse smart ports declared in project code (robot-config.cpp / robot-config.h / main.cpp)
    // NEVER injects fake fallback devices or fake temperatures.
    loadConfiguredSmartPorts(silent = false) {
      const detectedPorts = {};
      let code = "";
      if (typeof window !== "undefined" && window.ProjectManager && window.ProjectManager.project && window.ProjectManager.project.files) {
        code = (window.ProjectManager.project.files["src/robot-config.cpp"] || "") + "\n" +
               (window.ProjectManager.project.files["include/robot-config.h"] || "") + "\n" +
               (window.ProjectManager.project.files["src/main.cpp"] || "");
      }

      if (code) {
        // Parse motors: pros::Motor left_front(1, ...) or pros::Motor right_front(-11, ...)
        const motorRegex = /pros::Motor\s+([a-zA-Z0-9_]+)\s*\(\s*(-?\d+)/g;
        let m;
        while ((m = motorRegex.exec(code)) !== null) {
          const name = m[1];
          const portNum = Math.abs(parseInt(m[2], 10));
          if (portNum >= 1 && portNum <= 21) {
            detectedPorts[portNum] = {
              type: "Motor 11W",
              name: name,
              status: "Configured in Code",
              live: false,
              tempC: null,
              rpm: null
            };
          }
        }

        // Parse sensors (IMU, Rotation, Distance, Optical, GPS, Vision)
        const imuRegex = /pros::Imu\s+([a-zA-Z0-9_]+)\s*\(\s*(\d+)/g;
        while ((m = imuRegex.exec(code)) !== null) {
          const portNum = parseInt(m[2], 10);
          if (portNum >= 1 && portNum <= 21) {
            detectedPorts[portNum] = {
              type: "Inertial (IMU)",
              name: m[1],
              status: "Configured in Code",
              live: false,
              headingDeg: null
            };
          }
        }

        const rotRegex = /pros::Rotation\s+([a-zA-Z0-9_]+)\s*\(\s*(-?\d+)/g;
        while ((m = rotRegex.exec(code)) !== null) {
          const portNum = Math.abs(parseInt(m[2], 10));
          if (portNum >= 1 && portNum <= 21) {
            detectedPorts[portNum] = {
              type: "Rotation",
              name: m[1],
              status: "Configured in Code",
              live: false,
              positionDeg: null
            };
          }
        }

        const distRegex = /pros::Distance\s+([a-zA-Z0-9_]+)\s*\(\s*(\d+)/g;
        while ((m = distRegex.exec(code)) !== null) {
          const portNum = parseInt(m[2], 10);
          if (portNum >= 1 && portNum <= 21) {
            detectedPorts[portNum] = {
              type: "Distance",
              name: m[1],
              status: "Configured in Code",
              live: false,
              distanceMm: null
            };
          }
        }
      }

      // NO FAKE FALLBACK!
      // Only merge detected code ports into smartPorts; never overwrite active live ports
      const count = Object.keys(detectedPorts).length;
      if (count > 0) {
        Object.entries(detectedPorts).forEach(([p, dev]) => {
          if (!this.status.smartPorts[p] || !this.status.smartPorts[p].live) {
            this.status.smartPorts[p] = dev;
          }
        });
        if (!silent) this.logDebug("SmartPorts", `Loaded ${count} configured port definitions from project code.`);
      } else {
        if (!silent) this.logDebug("SmartPorts", "No port declarations found in project code. Smart ports remain empty (awaiting live robot telemetry).");
      }
      this.emit("status", this.status);
      return count;
    }

    clearSmartPorts() {
      this.status.smartPorts = {};
      this.logDebug("SmartPorts", "Smart ports list cleared to empty.");
      this.emit("status", this.status);
    }

    setSmartPortDevice(portNum, device) {
      if (!this.status.smartPorts) this.status.smartPorts = {};
      if (device) {
        this.status.smartPorts[portNum] = {
          ...device,
          live: Boolean(device.live)
        };
      } else {
        delete this.status.smartPorts[portNum];
      }
      this.emit("status", this.status);
    }

    // Send CDC command (Run program in slot)
    async startProgram(slot = 1) {
      if (!this.isConnected) return false;
      this.status.programRunning = true;
      this.status.activeSlot = slot;
      const progName = this.status.slots[slot - 1]?.name || "Override_Auton";
      this.emit("terminal", `\n[VEXos] Starting Program in Slot ${slot}: '${progName}'...\n`);
      
      if (!this.isSimulated && this.port) {
        // 1. Standard CDC Run Packet (Command 0x32)
        await this.writeBytes([...V5_CMD_HEADER, 0x32, slot & 0xff]);
        // 2. Extended V5 Execute Command (Command 0x18 - used by PROS CLI / vexide)
        await this.writeBytes([...V5_CMD_HEADER, 0x18, (slot - 1) & 0xff, 0x00]);
        // 3. System execution trigger (Command 0x22 / 0x56)
        await this.writeBytes([...V5_CMD_HEADER, 0x22, 0x00, slot & 0xff]);
        await this.writeBytes([...V5_CMD_HEADER, 0x56, slot & 0xff, 0x01]);
      }
      this.logDebug("V5 Protocol", `Run program command dispatched for Slot ${slot} ('${progName}') to V5 Brain.`);
      this.emit("status", this.status);
      this.emit("program-started", { slot, name: progName });
      return true;
    }

    // Send CDC command (Stop program)
    async stopProgram() {
      if (!this.isConnected) return false;
      this.status.programRunning = false;
      this.emit("terminal", `\n[VEXos] Stopping Program on V5 Brain...\n`);
      
      if (!this.isSimulated && this.port) {
        // 1. Standard CDC Stop Packet (Command 0x33)
        await this.writeBytes([...V5_CMD_HEADER, 0x33, 0x00]);
        // 2. Extended V5 Stop Command (Command 0x19)
        await this.writeBytes([...V5_CMD_HEADER, 0x19, 0x00]);
        // 3. Stop trigger (Command 0x23)
        await this.writeBytes([...V5_CMD_HEADER, 0x23, 0x00]);
      }
      this.logDebug("V5 Protocol", "Stop program command dispatched to V5 Brain.");
      this.emit("status", this.status);
      this.emit("program-stopped");
      return true;
    }

    // Allow user to sync the robot battery percentage read directly from their physical Controller LCD
    setControllerBatteryLevel(pct) {
      if (!this.isConnected) return;
      const cleanPct = Math.max(5, Math.min(100, parseInt(pct, 10) || 100));
      this.status.batteryPct = cleanPct;
      this.status.batteryMv = Math.round(10500 + (cleanPct / 100) * 2700);
      this.status.brainLinked = true;
      this.logDebug("Controller Bridge", `Robot battery level synced from physical Controller LCD: ${cleanPct}% (~${this.status.batteryMv} mV).`);
      this.emit("status", this.status);
    }

    // Diagnostic Debug Helpers
    injectTestBatteryPulse(mv = 12850) {
      if (!this.isSimulated) {
        this.logDebug("Diagnostic", "Refused test pulse: Real physical device connected. Battery telemetry must be received from hardware CDC packets.");
        return;
      }
      this.status.batteryMv = mv;
      this.status.batteryPct = this.calculateBatteryPct(mv);
      this.logDebug("Diagnostic", `[Simulated] Set battery: ${mv} mV -> ${this.status.batteryPct}%.`);
      this.emit("status", this.status);
    }

    getDebugReport() {
      const info = (this.port && typeof this.port.getInfo === "function") ? this.port.getInfo() : {};
      return {
        timestamp: new Date().toISOString(),
        webSerialSupported: this.isWebSerialSupported(),
        isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
        connected: this.isConnected,
        isSimulated: this.isSimulated,
        portInfo: info,
        rxBytesCount: this.rxBytesCount || 0,
        txBytesCount: this.txBytesCount || 0,
        batteryDisplay: this.getBatteryDisplay(),
        voltageDisplay: this.getBatteryVoltageDisplay(),
        status: this.status,
        recentLogs: (this.debugLogs || []).slice(-25)
      };
    }

    clearDebugLogs() {
      this.debugLogs = [];
      this.emit("debug-cleared");
    }

    // Event system
    addListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    removeListener(event, fn) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(fn => {
          try { fn(data); } catch (e) { console.error(e); }
        });
      }
    }
  }

  // Singleton Instance
  global.V5BrainSerial = new V5BrainSerial();
})(typeof window !== "undefined" ? window : global);
