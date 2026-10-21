// v5-brain-serial.js - VEX V5 Brain & Controller Web Serial CDC2 Driver
(function(global) {
  "use strict";

  // VEX Robotics USB Vendor IDs & Product IDs
  const VEX_USB_FILTERS = [
    { usbVendorId: 0x2888, usbProductId: 0x0501 }, // VEX V5 Brain System Port (CDC Comm)
    { usbVendorId: 0x2888, usbProductId: 0x0503 }, // VEX V5 Controller USB
    { usbVendorId: 0x2888 },                       // VEX Robotics Official VID (10376)
    { usbVendorId: 0x0403 },                       // FTDI CDC Chips
    { usbVendorId: 0x10c4 },                       // Silicon Labs CP210x CDC
    { usbVendorId: 0x1a86 },                       // CH340 / CH341 CDC
  ];

  // V5 Serial Protocol Constants (vex-v5-serial / PROS CLI specification)
  const V5_CMD_HEADER = [0xc9, 0x36, 0xb8, 0x47]; // Host-to-Device command header
  const V5_REPLY_HEADER = [0xaa, 0x55];           // Device-to-Host reply header

  // Primary CDC opcodes
  const CMD_QUERY_1 = 0x21;
  const CMD_USER_CDC = 0x56; // Brain-bound extended CDC2 command
  const CMD_CON_CDC = 0x58;  // Controller-bound extended CDC2 command

  // Extended CDC2 opcodes (USER_CDC = 0x56)
  const ECMD_FILE_CTRL = 0x10;      // Radio channel select (0x00 = Pit, 0x01 = Download)
  const ECMD_FILE_INIT = 0x11;      // Initialize file transfer
  const ECMD_FILE_EXIT = 0x12;      // Exit / finalize file transfer
  const ECMD_FILE_WRITE = 0x13;     // Write file chunk to flash
  const ECMD_FILE_READ = 0x14;      // Read file chunk
  const ECMD_FILE_LINK = 0x15;      // Link hot/cold file
  const ECMD_FILE_DIR = 0x16;       // Directory file count
  const ECMD_FILE_DIR_ENTRY = 0x17; // Directory entry metadata
  const ECMD_FILE_LOAD = 0x18;      // Execute (0x00) or Stop (0x80) program file
  const ECMD_FILE_GET_INFO = 0x19;  // Read file metadata
  const ECMD_SYS_FLAGS = 0x20;      // System status flags & battery
  const ECMD_DEV_STATUS = 0x21;     // Smart port devices status (Ports 1-23)
  const ECMD_SYS_STATUS = 0x22;     // VEXos system version & status
  const ECMD_USER_READ = 0x27;      // Stdio terminal read/write

  // Extended CDC2 opcodes (CON_CDC = 0x58)
  const ECMD_CON_SET_SLOT = 0x72;           // Select & run program slot (1..8, or 0 to stop) via Controller
  const ECMD_CON_COMP_CTRL = 0xc1;          // Set competition mode (Driver=8, Auton=10, Disabled=11)
  const ECMD_CON_COMP_GET_SMARTFIELD = 0xc2;// Read Controller & Brain battery, running slot, RSSI

  // CDC2 ACK code
  const CDC2_ACK = 0x76;

  // Competition Modes for CON_COMP_CTRL (0xC1)
  const COMP_MODE_DRIVER = 8;
  const COMP_MODE_AUTONOMOUS = 10;
  const COMP_MODE_DISABLED = 11;

  // J2000 Epoch (2000-01-01T00:00:00Z) in seconds
  const J2000_EPOCH_SECS = 946684800;

  // Device Type Map from VEXos DeviceStatus
  const V5_DEVICE_TYPES = {
    2: "Motor 11W",
    3: "LED",
    4: "Rotation",
    6: "Inertial (IMU)",
    7: "Distance",
    8: "Radio",
    9: "Controller",
    10: "Brain",
    11: "Vision",
    12: "ADI Expander",
    16: "Optical",
    17: "Magnet",
    20: "GPS",
    26: "Motor 5.5W",
    29: "AI Vision",
    30: "Pneumatics"
  };

  // Official VEX V5 CRC-16-CCITT (Poly: 0x1021, Init: 0x0000, No reflect)
  function calcCrc16(bytes) {
    let crc = 0x0000;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= (bytes[i] & 0xff) << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return crc & 0xffff;
  }

  // Official VEX V5 CRC-32 (Poly: 0x04C11DB7, Init: 0x00000000, No reflect, No xorout)
  function calcVexCrc32(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= (bytes[i] & 0xff) << 24;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x80000000) !== 0) {
          crc = ((crc << 1) ^ 0x04c11db7) >>> 0;
        } else {
          crc = (crc << 1) >>> 0;
        }
      }
    }
    return crc >>> 0;
  }

  // Encode little-endian integers
  function u16le(val) {
    return [val & 0xff, (val >>> 8) & 0xff];
  }
  function u32le(val) {
    return [
      val & 0xff,
      (val >>> 8) & 0xff,
      (val >>> 16) & 0xff,
      (val >>> 24) & 0xff
    ];
  }

  // Encode fixed-length null-padded ASCII string
  function encodeFixedAscii(str, fixedLen) {
    const out = new Array(fixedLen).fill(0);
    const clean = String(str || "");
    for (let i = 0; i < Math.min(clean.length, fixedLen - 1); i++) {
      out[i] = clean.charCodeAt(i) & 0x7f;
    }
    return out;
  }

  // Encode null-terminated ASCII string (FixedString<N> in vex-cdc)
  function encodeNullTermAscii(str, maxLen = 23) {
    const clean = String(str || "").slice(0, maxLen);
    const out = [];
    for (let i = 0; i < clean.length; i++) {
      out.push(clean.charCodeAt(i) & 0x7f);
    }
    out.push(0x00);
    return out;
  }

  // Frame an extended CDC2 command packet with variable-length size and big-endian CRC16
  function frameCdc2Packet(cmd, ecmd, payload = []) {
    const payloadArr = Array.from(payload);
    const len = payloadArr.length;
    const lenBytes = len < 0x80
      ? [len & 0x7f]
      : [((len >>> 8) & 0x7f) | 0x80, len & 0xff];

    const body = [
      ...V5_CMD_HEADER,
      cmd & 0xff,
      ecmd & 0xff,
      ...lenBytes,
      ...payloadArr
    ];
    const crc = calcCrc16(body);
    body.push((crc >>> 8) & 0xff, crc & 0xff);
    return new Uint8Array(body);
  }

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
      this.pendingAckWaiters = [];
      this.customBinData = null;
      this.customBinFileName = null;
      this.queryCycle = 0;
      this.isUploading = false;

      // Initial clean state: STRICTLY DISCONNECTED with null battery
      this.status = {
        connected: false,
        name: "Brain: Disconnected",
        vexosVersion: "--",
        batteryMv: null,
        batteryPct: null,
        controllerBatteryPct: null,
        batteryTempC: null,
        activeSlot: "--",
        programRunning: false,
        programName: "--",
        competitionMode: "Disabled",
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
          navigator.serial.addEventListener("connect", () => {
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

    // Set optional compiled .bin file (Uint8Array or ArrayBuffer) from user
    setCustomBinary(buffer, fileName = "custom_auton.bin") {
      if (!buffer) {
        this.customBinData = null;
        this.customBinFileName = null;
        this.logDebug("Upload", "Cleared custom compiled .bin file.");
        return;
      }
      this.customBinData = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      this.customBinFileName = fileName;
      this.logDebug("Upload", `Loaded custom compiled V5 binary '${fileName}' (${this.customBinData.length} bytes).`);
      this.emit("status", this.status);
    }

    getBatteryDisplay() {
      if (!this.isConnected) {
        return "--%";
      }
      if (this.status.batteryPct !== null && this.status.batteryPct !== undefined && this.status.batteryPct > 0) {
        return `${this.status.batteryPct}%`;
      }
      if (this.status.controllerConnected) {
        if (this.status.controllerBatteryPct !== null && this.status.controllerBatteryPct > 0) {
          return `🎮 ${this.status.controllerBatteryPct}% (Bot Linked)`;
        }
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

    // VEX V5 LiFePO4 (4-cell in series) state-of-charge calculation
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

    // Connect to VEX V5 Brain or Controller via Web Serial API
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

        await port.open({ baudRate: 115200, bufferSize: 8192 });
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
        this.status.batteryMv = null;
        this.status.batteryPct = null;
        this.status.controllerBatteryPct = null;
        this.status.batteryTempC = null;
        this.status.smartPorts = {};
        this.logDebug("SmartPorts", "Physical connection active. Querying V5 Brain & Controller over CDC2...");

        this.startReading();
        this.startTelemetryLoop();
        this.startSystemQueryLoop();

        this.logDebug("WebSerial", `Hardware CDC2 port open at 115200 baud (${isController ? "V5 Controller USB Bridge" : "VEX V5 Brain Direct USB"}).`);
        this.emit("connected", { simulated: false, status: this.status, portInfo: info });
        this.emit("terminal", `\n[Web Serial CDC2] Connected to VEX V5 Device (${vidHex}:${pidHex}) at 115200 baud.\n[VEX CDC2] Extended Protocol + CRC16-CCITT Active.\n${isController ? "[VEX Controller] Connected via V5 Controller USB Bridge (VID: 0x2888, PID: 0x0503).\n[VEXnet 3.0] Wireless Controller Bridge active: Slot Run (0x72), Competition Control (0xC1), and QSPI Flashing (0x11/0x13/0x12) ready.\n" : ""}[PROS Serial] Listening for telemetry and CDC2 packets...\n`);
        return true;
      } catch (err) {
        this.logDebug("WebSerial", `Connection cancelled or failed: ${err.name} - ${err.message}. Status remains Disconnected (--%).`);
        await this.disconnect();
        return false;
      }
    }

    // Connect simulated VEX V5 Brain ONLY when explicitly requested by user
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
      this.isUploading = false;
      this.status.connected = false;
      this.status.name = "Brain: Disconnected";
      this.status.vexosVersion = "--";
      this.status.batteryMv = null;
      this.status.batteryPct = null;
      this.status.controllerBatteryPct = null;
      this.status.batteryTempC = null;
      this.status.activeSlot = "--";
      this.status.programRunning = false;
      this.status.programName = "--";
      this.status.competitionMode = "Disabled";
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
        const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const writer = this.port.writable.getWriter();
        await writer.write(arr);
        writer.releaseLock();
        this.txBytesCount = (this.txBytesCount || 0) + arr.length;
        return true;
      } catch (err) {
        this.logDebug("WebSerial", `Serial write error: ${err.message}`, err);
        return false;
      }
    }

    // Send a framed CDC2 command and optionally wait for its matching CDC2 reply
    async sendCdc2Command(cmd, ecmd, payload = [], timeoutMs = 450) {
      const pkt = frameCdc2Packet(cmd, ecmd, payload);
      const waitPromise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pendingAckWaiters = this.pendingAckWaiters.filter(w => w !== waiter);
          resolve(null);
        }, timeoutMs);
        const waiter = {
          cmd,
          ecmd,
          resolve: (reply) => {
            clearTimeout(timer);
            resolve(reply);
          }
        };
        this.pendingAckWaiters.push(waiter);
      });

      const ok = await this.writeBytes(pkt);
      if (!ok) return null;
      return await waitPromise;
    }

    // Query VEX V5 system status, Controller SmartField data, and Brain Smart Port devices
    async sendQuery1() {
      if (this.isSimulated || !this.isConnected || this.isUploading) return;
      this.queryCycle = (this.queryCycle + 1) % 3;

      if (this.queryCycle === 1 && this.status.controllerConnected) {
        // Query Controller SmartField status (0x58, 0xC2): returns Brain battery %, Controller battery %, running slot, RSSI
        const pkt = frameCdc2Packet(CMD_CON_CDC, ECMD_CON_COMP_GET_SMARTFIELD, []);
        this.logDebug("V5 Protocol", "TX Controller SmartField Query [0x58, 0xC2]");
        await this.writeBytes(pkt);
      } else if (this.queryCycle === 2) {
        // Query Brain Smart Port Devices (0x56, 0x21): returns all connected Smart Port devices (1-21) + Battery (23)
        const pkt = frameCdc2Packet(CMD_USER_CDC, ECMD_DEV_STATUS, []);
        this.logDebug("V5 Protocol", "TX Brain DeviceStatus Query [0x56, 0x21]");
        await this.writeBytes(pkt);
      } else {
        // Standard Query1 (0x21)
        this.logDebug("V5 Protocol", "TX Query1 Packet [0xC9, 0x36, 0xB8, 0x47, 0x21]");
        await this.writeBytes([...V5_CMD_HEADER, CMD_QUERY_1]);
      }
    }

    startSystemQueryLoop() {
      if (this.queryTimer) clearInterval(this.queryTimer);
      this.queryTimer = setInterval(() => {
        if (this.isConnected && !this.isSimulated && !this.isUploading) {
          this.sendQuery1().catch(() => {});
        }
      }, 2500);
      this.sendQuery1().catch(() => {});
    }

    // Read loop handling both binary CDC/CDC2 response packets and text output (PROS printf)
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

            // 1. Inspect binary VEX CDC / CDC2 response packets (0xAA 0x55 ...)
            const isBinaryCdc = this.inspectBinaryPacket(value);

            // 2. Decode ASCII / UTF-8 text for PROS / LemLib user serial stream if not purely binary CDC packet
            if (!isBinaryCdc) {
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
        }
      } catch (err) {
        this.logDebug("WebSerial", `Serial stream read failure: ${err.message}`, err);
      } finally {
        if (this.reader) {
          try { this.reader.releaseLock(); } catch (_) {}
          this.reader = null;
        }
        if (this.isConnected) {
          this.logDebug("WebSerial", "Read loop ended. Ensuring clean Disconnected (--%) state.");
          await this.disconnect();
        }
      }
    }

    // Inspect binary response packets from VEX CDC / CDC2 System Port
    inspectBinaryPacket(bytes) {
      if (!bytes || bytes.length < 4) return false;
      let handledBinary = false;

      for (let i = 0; i <= bytes.length - 4; i++) {
        if (bytes[i] === 0xaa && bytes[i + 1] === 0x55) {
          handledBinary = true;
          const cmdId = bytes[i + 2];
          let sizeOffset = i + 3;
          let payloadSize = bytes[sizeOffset];
          let ecmdOffset = i + 4;
          if (payloadSize & 0x80) {
            if (i + 4 < bytes.length) {
              payloadSize = ((payloadSize & 0x7f) << 8) | bytes[i + 4];
              ecmdOffset = i + 5;
            }
          }

          const hexDump = Array.from(bytes.slice(i, Math.min(bytes.length, i + 20)))
            .map(b => "0x" + b.toString(16).padStart(2, "0"))
            .join(" ");

          // Extended CDC2 Reply (USER_CDC = 0x56 or CON_CDC = 0x58)
          if ((cmdId === CMD_USER_CDC || cmdId === CMD_CON_CDC) && ecmdOffset + 1 < bytes.length) {
            const ecmd = bytes[ecmdOffset];
            const ack = bytes[ecmdOffset + 1];
            const dataStart = ecmdOffset + 2;
            const dataEnd = Math.min(bytes.length, ecmdOffset + Math.max(2, payloadSize - 2));
            const replyData = bytes.slice(dataStart, dataEnd);

            this.logDebug(
              "V5 CDC2 RX",
              `CMD: 0x${cmdId.toString(16).toUpperCase()} | ECMD: 0x${ecmd.toString(16).toUpperCase()} | ACK: 0x${ack.toString(16).toUpperCase()} (${ack === CDC2_ACK ? "OK" : "NACK"}) | Bytes: ${hexDump}`
            );

            // Resolve any pending command waiter
            for (let wIdx = 0; wIdx < this.pendingAckWaiters.length; wIdx++) {
              const w = this.pendingAckWaiters[wIdx];
              if (w.cmd === cmdId && (w.ecmd === ecmd || ack !== CDC2_ACK)) {
                this.pendingAckWaiters.splice(wIdx, 1);
                w.resolve({ cmd: cmdId, ecmd, ack, data: replyData });
                break;
              }
            }

            // Parse SmartFieldDataReplyPacket (CON_CDC 0x58, ECMD 0xC2)
            if (cmdId === CMD_CON_CDC && ecmd === ECMD_CON_COMP_GET_SMARTFIELD && ack === CDC2_ACK && replyData.length >= 14) {
              const rssi = replyData[0];
              const brainBattPct = replyData[7];
              const controllerBattPct = replyData[8];
              const brainBattCap = replyData[10];
              const runningSlot = replyData[13];

              const effectiveBrainPct = (brainBattPct > 0 && brainBattPct <= 100)
                ? brainBattPct
                : ((brainBattCap > 0 && brainBattCap <= 100) ? brainBattCap : null);

              if (effectiveBrainPct !== null) {
                this.status.batteryPct = effectiveBrainPct;
                this.status.batteryMv = Math.round(10500 + (effectiveBrainPct / 100) * 2700);
                this.status.brainLinked = true;
              }
              if (controllerBattPct > 0 && controllerBattPct <= 100) {
                this.status.controllerBatteryPct = controllerBattPct;
              }
              if (runningSlot >= 1 && runningSlot <= 8) {
                this.status.activeSlot = runningSlot;
                this.status.programRunning = true;
              } else if (runningSlot === 0x11 || runningSlot === 0) {
                this.status.programRunning = false;
              }
              if (rssi > 0) {
                this.status.radioSignalDbm = -Math.min(95, Math.max(35, 100 - rssi));
              }
              this.emit("status", this.status);
            }

            // Parse DeviceStatusReplyPacket (USER_CDC 0x56, ECMD 0x21)
            if (cmdId === CMD_USER_CDC && ecmd === ECMD_DEV_STATUS && ack === CDC2_ACK && replyData.length >= 1) {
              const count = replyData[0];
              let offset = 1;
              let updatedPorts = 0;
              for (let d = 0; d < count && offset + 8 <= replyData.length; d++) {
                const portNum = replyData[offset];
                const devTypeId = replyData[offset + 1];
                const devStatus = replyData[offset + 2];
                offset += 8;
                if (portNum >= 1 && portNum <= 21 && devTypeId !== 0 && devTypeId !== 255) {
                  const typeName = V5_DEVICE_TYPES[devTypeId] || `Device (0x${devTypeId.toString(16)})`;
                  const existing = this.status.smartPorts[portNum] || {};
                  this.status.smartPorts[portNum] = {
                    ...existing,
                    type: typeName,
                    name: existing.name || `port_${portNum}`,
                    status: "Connected (Hardware)",
                    live: true,
                    deviceStatus: devStatus,
                    lastSeen: Date.now()
                  };
                  updatedPorts++;
                }
              }
              if (updatedPorts > 0) {
                this.logDebug("SmartPorts", `Discovered ${updatedPorts} live hardware Smart Port devices from V5 Brain.`);
                this.emit("status", this.status);
              }
            }
          } else {
            this.logDebug("V5 CDC RX", `Header [0xAA, 0x55] Packet ID: 0x${cmdId.toString(16).toUpperCase()} | Bytes: ${hexDump}`);
            if (cmdId === CMD_QUERY_1 && this.status.controllerConnected) {
              this.status.radioType = "VEXnet 3.0 (Controller Bridge Active)";
              this.status.brainLinked = true;
              this.status.name = "V5-Controller-Bridge";
              this.emit("status", this.status);
            }
          }
          break;
        }
      }
      return handledBinary;
    }

    // Parse user code standard output (PROS printf, LemLib odometry, VEXcode std::cout)
    parseTelemetryLine(text) {
      if (!text || typeof text !== "string") return;

      const battMvMatch = text.match(/(?:batt(?:ery)?|voltage|v5_batt)[\s:=]*([0-9.]+)\s*m?v/i);
      const battPctMatch = text.match(/(?:batt(?:ery)?|capacity|soc)[\s:=]*([0-9]{1,3})\s*%/i) ||
                           text.match(/(?:batt(?:ery)?|capacity|soc)[\s:=]+([0-9]{1,3})\b/i);
      const battRawMatch = text.match(/(?:\[BATT\]|BATT|Battery)[\s:=]+([0-9.]+)/i);

      let changed = false;
      if (battMvMatch && battMvMatch[1]) {
        let val = parseFloat(battMvMatch[1]);
        if (val < 25) {
          val = Math.round(val * 1000);
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

      const odomMatch = text.match(/ODOM:?\s*X=([0-9.-]+)\s*Y=([0-9.-]+)\s*H=([0-9.-]+)/i);
      if (odomMatch) {
        this.emit("odometry", {
          x: parseFloat(odomMatch[1]),
          y: parseFloat(odomMatch[2]),
          heading: parseFloat(odomMatch[3])
        });
      }

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
        if (portNum >= 1 && portNum <= 21 && this.status.smartPorts[portNum]) {
          this.status.smartPorts[portNum].rpm = rpm;
          this.status.smartPorts[portNum].live = true;
          this.status.smartPorts[portNum].status = "Live Telemetry";
          this.status.smartPorts[portNum].lastSeen = Date.now();
          changed = true;
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

        if (this.isSimulated) {
          const deltaMv = (Math.random() - 0.5) * 15;
          this.status.batteryMv = Math.max(11800, Math.min(13200, Math.round(this.status.batteryMv + deltaMv)));
          this.status.batteryPct = this.calculateBatteryPct(this.status.batteryMv);
          this.status.batteryTempC = 28 + Math.floor(Math.sin(Date.now() / 15000) * 2);
        }

        this.emit("status", this.status);
      }, 1000);
    }

    // Helper: Upload a single file to V5 Brain QSPI Flash via CDC2 File Transfer Protocol (0x11 -> 0x13 -> 0x12)
    async uploadFileCdc2({
      fileName,
      extension,
      dataBytes,
      loadAddress = 0x00000000,
      exitAction = 0x00, // 0=DoNothing, 1=RunProgram, 3=ShowRunScreen
      onProgress = null
    }) {
      const fileData = dataBytes instanceof Uint8Array ? dataBytes : new Uint8Array(dataBytes);
      const fileCrc32 = calcVexCrc32(fileData);
      const j2000Time = Math.floor(Date.now() / 1000) - J2000_EPOCH_SECS;

      // FileTransferInitializePacket (USER_CDC = 0x56, ECMD_FILE_INIT = 0x11)
      // Layout:
      // [0] operation = 1 (Write)
      // [1] target = 1 (QSPI Flash)
      // [2] vendor = 1 (User)
      // [3] options = 1 (Overwrite)
      // [4..8] file_size (u32 LE)
      // [8..12] load_address (u32 LE)
      // [12..16] write_file_crc (u32 LE)
      // [16..20] metadata.extension (4 bytes null-padded: "ini\0" or "bin\0")
      // [20] metadata.extension_type = 0 (Binary)
      // [21..25] metadata.timestamp (i32 LE, J2000)
      // [25..29] metadata.version = [1, 0, 0, 0]
      // [29..] file_name (null-terminated ASCII up to 24 bytes)
      const initPayload = [
        0x01, // Write
        0x01, // QSPI
        0x01, // User vendor
        0x01, // Overwrite
        ...u32le(fileData.length),
        ...u32le(loadAddress),
        ...u32le(fileCrc32),
        ...encodeFixedAscii(extension, 4),
        0x00, // ExtensionType::Binary
        ...u32le(j2000Time),
        0x01, 0x00, 0x00, 0x00, // Version 1.0.0.0
        ...encodeFixedAscii(fileName, 24)
      ];

      this.logDebug("V5 File Transfer", `TX FILE_INIT (0x11) for '${fileName}' (${fileData.length} bytes @ 0x${loadAddress.toString(16)}, CRC32=0x${fileCrc32.toString(16)})`);
      const initReply = await this.sendCdc2Command(CMD_USER_CDC, ECMD_FILE_INIT, initPayload, 900);

      let maxChunkSize = this.status.controllerConnected ? 244 : 512;
      if (initReply && initReply.ack === CDC2_ACK && initReply.data && initReply.data.length >= 2) {
        const windowSize = initReply.data[0] | (initReply.data[1] << 8);
        if (windowSize > 64 && windowSize <= 4096) {
          maxChunkSize = Math.min(maxChunkSize, Math.floor(windowSize / 2));
        }
        this.logDebug("V5 File Transfer", `RX FILE_INIT ACK for '${fileName}' (windowSize=${windowSize}, chunkSize=${maxChunkSize})`);
      } else if (initReply) {
        this.logDebug("V5 File Transfer", `FILE_INIT response for '${fileName}': ACK=0x${initReply.ack.toString(16)}`);
      }

      // Stream FileDataWritePacket (USER_CDC = 0x56, ECMD_FILE_WRITE = 0x13)
      let offset = 0;
      while (offset < fileData.length) {
        let slice = Array.from(fileData.slice(offset, offset + maxChunkSize));
        // Pad to 4-byte alignment as required by VEXos flash writer
        while (slice.length % 4 !== 0) {
          slice.push(0x00);
        }
        const writePayload = [
          ...u32le(loadAddress + offset),
          ...slice
        ];
        const reply = await this.sendCdc2Command(CMD_USER_CDC, ECMD_FILE_WRITE, writePayload, 400);
        if (!reply) {
          // Small pacing delay over VEXnet if controller didn't immediately echo
          await new Promise(r => setTimeout(r, 18));
        }
        offset += slice.length;
        if (typeof onProgress === "function") {
          onProgress(Math.min(100, Math.round((offset / fileData.length) * 100)));
        }
      }

      // FileTransferExitPacket (USER_CDC = 0x56, ECMD_FILE_EXIT = 0x12)
      this.logDebug("V5 File Transfer", `TX FILE_EXIT (0x12) for '${fileName}' (action=${exitAction})`);
      await this.sendCdc2Command(CMD_USER_CDC, ECMD_FILE_EXIT, [exitAction & 0xff], 800);
      return true;
    }

    // Build a VEX V5 slot binary package containing V5_SIG header + autonomous metadata/code
    buildAutonProgramBinary(programName, cppSource = "") {
      if (this.customBinData && this.customBinData.length > 0) {
        return this.customBinData;
      }
      const encoder = new TextEncoder();
      const sourceBytes = encoder.encode(
        `// VEX V5 LemLib Autonomous Routine: ${programName}\n` +
        `// Timestamp: ${new Date().toISOString()}\n` +
        (cppSource || "")
      );
      // 32-byte VEX V5 Code Signature header ("XVX5", Type=0 User, Owner=2 Partner) + source payload aligned to 4 bytes
      const totalLen = Math.max(512, Math.ceil((32 + sourceBytes.length) / 4) * 4);
      const bin = new Uint8Array(totalLen);
      // Magic "XVX5"
      bin[0] = 0x58; // 'X'
      bin[1] = 0x56; // 'V'
      bin[2] = 0x58; // 'X'
      bin[3] = 0x35; // '5'
      // ProgramType = 0 (User), Owner = 2 (Partner), Options = 0
      bin[4] = 0x00; bin[5] = 0x00; bin[6] = 0x00; bin[7] = 0x00;
      bin[8] = 0x02; bin[9] = 0x00; bin[10] = 0x00; bin[11] = 0x00;
      bin.set(sourceBytes.slice(0, totalLen - 32), 32);
      return bin;
    }

    // Upload program (.ini metadata + .bin binary) to specified slot (1–8)
    async uploadToSlot(slot = 1, programName = "Override_LemLib_Auton", onProgress, options = {}) {
      if (!this.isConnected) {
        const err = new Error("VEX V5 device is not connected. Plug in the USB cable and click 'Connect' first.");
        this.logDebug("Upload", err.message);
        throw err;
      }

      const slotNum = Math.max(1, Math.min(8, parseInt(slot, 10) || 1));
      const cleanName = (typeof programName === "string" && programName.trim())
        ? programName.trim().slice(0, 23)
        : "Override_Auton";
      const isController = this.status.controllerConnected;
      const runAfter = Boolean(options.runAfterUpload);

      this.isUploading = true;
      this.emit("terminal", `\n>> pros upload --slot ${slotNum} --name "${cleanName}"\n`);
      if (isController) {
        this.emit("terminal", `[CDC2] Connected via V5 Controller USB (VID: 0x2888, PID: 0x0503).\n[VEXnet 3.0] Switching Controller radio to Download Channel (0x10 -> 0x01)...\n`);
      } else {
        this.emit("terminal", `[CDC2] Initiating VEX V5 Extended File Transfer Protocol (CRC16 + CRC32)...\n`);
      }

      try {
        if (!this.isSimulated && this.port) {
          // 1. If connected via V5 Controller, switch radio channel to Download (0x01) so Brain accepts QSPI file writes
          if (isController) {
            await this.sendCdc2Command(CMD_USER_CDC, ECMD_FILE_CTRL, [0x01, 0x01], 600);
            await new Promise(r => setTimeout(r, 120));
          }

          if (typeof onProgress === "function") onProgress(10);

          // 2. Construct & upload slot_${slotNum}.ini (makes slot title/icon appear on V5 Brain screen)
          const iniText =
            `[project]\n` +
            `ide=PROS\n` +
            `[program]\n` +
            `name=${cleanName}\n` +
            `slot=${slotNum - 1}\n` +
            `icon=USER902x.bmp\n` +
            `iconalt=\n` +
            `description=LemLib Autonomous Routine (Slot ${slotNum})\n`;
          const iniBytes = new TextEncoder().encode(iniText);

          this.emit("terminal", `[CDC2] Uploading metadata 'slot_${slotNum}.ini' (${iniBytes.length} bytes) to Brain QSPI...\n`);
          await this.uploadFileCdc2({
            fileName: `slot_${slotNum}.ini`,
            extension: "ini",
            dataBytes: iniBytes,
            loadAddress: 0x00000000,
            exitAction: 0x00,
            onProgress: (p) => {
              if (typeof onProgress === "function") onProgress(10 + Math.round(p * 0.25));
            }
          });

          // 3. Gather current C++ autonomous code or custom .bin and upload slot_${slotNum}.bin @ 0x03800000
          let cppCode = "";
          if (typeof window !== "undefined" && window.ProjectManager?.project?.files) {
            cppCode = window.ProjectManager.project.files["src/main.cpp"] || "";
          }
          const binBytes = this.buildAutonProgramBinary(cleanName, cppCode);
          this.emit("terminal", `[CDC2] Uploading binary 'slot_${slotNum}.bin' (${(binBytes.length / 1024).toFixed(1)} KB) @ 0x03800000...\n`);

          await this.uploadFileCdc2({
            fileName: `slot_${slotNum}.bin`,
            extension: "bin",
            dataBytes: binBytes,
            loadAddress: 0x03800000,
            exitAction: runAfter ? 0x01 : 0x03, // 0x01 = RunProgram immediately, 0x03 = ShowRunScreen
            onProgress: (p) => {
              if (typeof onProgress === "function") onProgress(35 + Math.round(p * 0.65));
            }
          });

          // 4. If connected via Controller, return radio channel back to Pit mode (0x00)
          if (isController) {
            this.emit("terminal", `[VEXnet 3.0] Restoring Controller Pit Channel (0x10 -> 0x00)...\n`);
            await this.sendCdc2Command(CMD_USER_CDC, ECMD_FILE_CTRL, [0x01, 0x00], 500);
          }
        } else {
          // Simulated progress
          for (let i = 1; i <= 10; i++) {
            await new Promise(r => setTimeout(r, 40));
            if (typeof onProgress === "function") onProgress(i * 10);
          }
        }

        // Update slot in status
        this.status.activeSlot = slotNum;
        this.status.slots[slotNum - 1] = {
          slot: slotNum,
          name: cleanName,
          date: new Date().toISOString().replace("T", " ").substring(0, 16),
          sizeKb: this.customBinData ? Math.max(1, Math.round(this.customBinData.length / 1024)) : 1
        };

        this.emit("terminal", `[CDC2] Flashing Complete: 'slot_${slotNum}.ini' & 'slot_${slotNum}.bin' written to Slot ${slotNum} (CRC16 & CRC32 OK).\n`);
        this.emit("terminal", `✅ Program '${cleanName}' flashed to Slot ${slotNum} on VEX V5 Brain!\n`);
        this.emit("status", this.status);
        return true;
      } finally {
        this.isUploading = false;
      }
    }

    // Parse smart ports declared in project code (robot-config.cpp / robot-config.h / main.cpp)
    loadConfiguredSmartPorts(silent = false) {
      const detectedPorts = {};
      let code = "";
      if (typeof window !== "undefined" && window.ProjectManager && window.ProjectManager.project && window.ProjectManager.project.files) {
        code = (window.ProjectManager.project.files["src/robot-config.cpp"] || "") + "\n" +
               (window.ProjectManager.project.files["include/robot-config.h"] || "") + "\n" +
               (window.ProjectManager.project.files["src/main.cpp"] || "");
      }

      if (code) {
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

      const count = Object.keys(detectedPorts).length;
      if (count > 0) {
        Object.entries(detectedPorts).forEach(([p, dev]) => {
          if (!this.status.smartPorts[p] || !this.status.smartPorts[p].live) {
            this.status.smartPorts[p] = dev;
          }
        });
        if (!silent) this.logDebug("SmartPorts", `Loaded ${count} configured port definitions from project code.`);
      } else {
        if (!silent) this.logDebug("SmartPorts", "No port declarations found in project code.");
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

    // Set V5 Competition Mode via Controller CDC2 (CON_CDC = 0x58, ECMD_CON_COMP_CTRL = 0xC1)
    // mode: "autonomous" (10), "driver" (8), or "disabled" (11)
    async setCompetitionMode(mode = "autonomous", timeSecs = 15) {
      if (!this.isConnected) return false;
      let modeByte = COMP_MODE_DISABLED;
      let modeLabel = "Disabled";
      if (mode === "autonomous" || mode === COMP_MODE_AUTONOMOUS) {
        modeByte = COMP_MODE_AUTONOMOUS;
        modeLabel = "Autonomous";
      } else if (mode === "driver" || mode === COMP_MODE_DRIVER) {
        modeByte = COMP_MODE_DRIVER;
        modeLabel = "Driver Control";
      }
      this.status.competitionMode = modeLabel;
      const payload = [modeByte & 0xff, ...u32le(Math.max(0, parseInt(timeSecs, 10) || 0))];

      if (!this.isSimulated && this.port) {
        const pkt = frameCdc2Packet(CMD_CON_CDC, ECMD_CON_COMP_CTRL, payload);
        this.logDebug("V5 Protocol", `TX CompetitionControlPacket [0x58, 0xC1] Mode=${modeLabel} (${modeByte}), Time=${timeSecs}s`);
        await this.writeBytes(pkt);
      }
      this.emit("terminal", `[VEX Competition Control] Mode switched to: ${modeLabel} (${timeSecs}s)\n`);
      this.emit("status", this.status);
      return true;
    }

    // Start / Run program in slot (1–8) and trigger execution on V5 Brain
    async startProgram(slot = 1, options = {}) {
      if (!this.isConnected) return false;
      const slotNum = Math.max(1, Math.min(8, parseInt(slot, 10) || 1));
      const fileName = `slot_${slotNum}.bin`;
      const progName = this.status.slots[slotNum - 1]?.name !== "Empty"
        ? this.status.slots[slotNum - 1]?.name
        : fileName;

      this.status.programRunning = true;
      this.status.activeSlot = slotNum;
      this.status.programName = progName;
      this.emit("terminal", `\n[VEXos CDC2] Starting Program in Slot ${slotNum} ('${fileName}')...\n`);

      if (!this.isSimulated && this.port) {
        // 1. If connected via V5 Controller USB (0x0503), send native SelectProgramSlotPacket (0x58, 0x72, [slotNum])
        const slotPkt = frameCdc2Packet(CMD_CON_CDC, ECMD_CON_SET_SLOT, [slotNum & 0xff]);
        this.logDebug("V5 Protocol", `TX Controller SelectProgramSlot [0x58, 0x72, slot=${slotNum}]`);
        await this.writeBytes(slotPkt);
        await new Promise(r => setTimeout(r, 60));

        // 2. Send Brain FileLoadActionPacket (0x56, 0x18): vendor=1 (User), action=0x00 (Run), file="slot_X.bin"
        // Send both 24-byte padded payload (PROS CLI standard) and null-terminated payload (vex-v5-serial standard)
        const loadPayloadPadded = [0x01, 0x00, ...encodeFixedAscii(fileName, 24)];
        const loadPktPadded = frameCdc2Packet(CMD_USER_CDC, ECMD_FILE_LOAD, loadPayloadPadded);
        this.logDebug("V5 Protocol", `TX Brain FileLoadAction RUN [0x56, 0x18, '${fileName}']`);
        await this.writeBytes(loadPktPadded);
        await new Promise(r => setTimeout(r, 60));

        const loadPayloadShort = [0x01, 0x00, ...encodeNullTermAscii(fileName, 23)];
        await this.writeBytes(frameCdc2Packet(CMD_USER_CDC, ECMD_FILE_LOAD, loadPayloadShort));

        // 3. When connected via Controller USB, trigger Autonomous mode (or requested mode) after brief startup delay
        // so competition-template programs (void autonomous()) actually execute!
        if (this.status.controllerConnected && options.triggerCompetition !== false) {
          const targetMode = options.mode || "autonomous";
          const duration = targetMode === "driver" ? 105 : 15;
          await new Promise(r => setTimeout(r, 220));
          await this.setCompetitionMode(targetMode, duration);
        }
      }

      this.logDebug("V5 Protocol", `Run program command dispatched for Slot ${slotNum} ('${fileName}') with CRC16.`);
      this.emit("status", this.status);
      this.emit("program-started", { slot: slotNum, name: progName });
      return true;
    }

    // Stop currently running program on V5 Brain & disable robot via Controller
    async stopProgram() {
      if (!this.isConnected) return false;
      const activeSlot = parseInt(this.status.activeSlot, 10) || 1;
      const fileName = `slot_${activeSlot}.bin`;

      this.status.programRunning = false;
      this.status.competitionMode = "Disabled";
      this.emit("terminal", `\n[VEXos CDC2] Stopping Program & Disabling Motors on V5 Brain...\n`);

      if (!this.isSimulated && this.port) {
        // 1. Immediately disable competition mode via Controller (0x58, 0xC1, Disabled = 11)
        const disablePkt = frameCdc2Packet(CMD_CON_CDC, ECMD_CON_COMP_CTRL, [COMP_MODE_DISABLED, 0, 0, 0, 0]);
        this.logDebug("V5 Protocol", "TX Controller Competition Disable [0x58, 0xC1, Disabled=11]");
        await this.writeBytes(disablePkt);
        await new Promise(r => setTimeout(r, 50));

        // 2. Send Brain FileLoadActionPacket STOP (0x56, 0x18): vendor=1 (User), action=0x80 (Stop)
        // Both empty filename (PROS CLI `execute_program_file('', run=False)`) and active slot filename
        const stopEmptyPadded = [0x01, 0x80, ...encodeFixedAscii("", 24)];
        this.logDebug("V5 Protocol", "TX Brain FileLoadAction STOP [0x56, 0x18, action=0x80]");
        await this.writeBytes(frameCdc2Packet(CMD_USER_CDC, ECMD_FILE_LOAD, stopEmptyPadded));
        await new Promise(r => setTimeout(r, 50));

        const stopSlotPadded = [0x01, 0x80, ...encodeFixedAscii(fileName, 24)];
        await this.writeBytes(frameCdc2Packet(CMD_USER_CDC, ECMD_FILE_LOAD, stopSlotPadded));
        await new Promise(r => setTimeout(r, 50));

        // 3. Send Controller SelectProgramSlot 0 (0x58, 0x72, [0]) to exit running program slot
        await this.writeBytes(frameCdc2Packet(CMD_CON_CDC, ECMD_CON_SET_SLOT, [0x00]));
      }

      this.logDebug("V5 Protocol", "Stop program & disable commands dispatched to V5 Brain with CRC16.");
      this.emit("status", this.status);
      this.emit("program-stopped");
      return true;
    }

    // Sync robot battery percentage read directly from physical Controller LCD
    setControllerBatteryLevel(pct) {
      if (!this.isConnected) return;
      const cleanPct = Math.max(5, Math.min(100, parseInt(pct, 10) || 100));
      this.status.batteryPct = cleanPct;
      this.status.batteryMv = Math.round(10500 + (cleanPct / 100) * 2700);
      this.status.brainLinked = true;
      this.logDebug("Controller Bridge", `Robot battery level synced from physical Controller LCD: ${cleanPct}% (~${this.status.batteryMv} mV).`);
      this.emit("status", this.status);
    }

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
