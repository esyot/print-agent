# Print & Display Agent 🖨️📺

A lightweight, background Node.js Express server that can be compiled into a standalone Windows executable (`.exe`). It exposes a local HTTP API to list printers, silently spool raw print payloads (ESC/POS receipts, ZPL labels, RAW binaries) directly to local/network printers, and update VFD customer pole displays via serial ports (COM3).

---

## 🌟 Key Features

* **Silent RAW Printing**: Bypasses OS print dialogs using Windows `winspool.Drv` native APIs (via PowerShell) or CUPS/`unix-print` on Linux/macOS.
* **VFD Customer Pole Display Support**: Sends text (2x20 matrix format with auto-clearing) or raw binary streams over serial ports (`COM3` @ 9600 baud).
* **Printer Enumeration**: Auto-detects local and network-installed printers on Windows, Linux, and macOS.
* **CORS-Enabled**: Easily trigger print or display operations directly from web-based POS or ERP frontends.

---

## 📁 Repository Structure

```text
silent-print-agent/
├── node_modules/        # Local dependencies
├── dist/                # Output directory for compiled standalone .exe
│   └── print-agent.exe
├── server.js            # Main Express application source
├── package.json         # Project metadata and dependencies
└── README.md            # Documentation
