# Silent Print Agent

A lightweight, background Node.js Express server compiled into a standalone Windows executable (`.exe`). It exposes a local HTTP API to list printers and silently spool raw print payloads (like ESC/POS receipts, ZPL labels, or RAW binaries) directly to local or network printers.

---

## 📁 Repository Structure

```text
silent-print-agent/
├── node_modules/       # Local dependencies (including pkg)
├── dist/               # Holds the compiled Windows executable
│   └── print-agent.exe
├── server.js           # Main application source code
├── package.json        # Project metadata & dependencies
└── README.md           # Setup and API documentation
```
