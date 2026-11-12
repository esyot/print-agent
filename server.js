/**
 * Silent Print & Display Agent
 * -----------------------------
 * Local HTTP bridge that lets a web app silently:
 *   - send raw ESC/POS buffers to a serial display (default COM3 @ 9600)
 *   - send raw ESC/POS buffers to any installed printer (Windows RAW spool,
 *     or CUPS via lpstat / unix-print on macOS & Linux)
 *   - enumerate installed printers
 *   - check health
 *
 * Env vars:
 *   PORT         HTTP port (default 4444)
 *   SERIAL_PORT  Windows COM port for /display (default COM3)
 *
 * Endpoints:
 *   POST /display   { base64 } | { text_line1, text_line2 }
 *   POST /print     { printer_name, base64 }
 *   GET  /printers
 *   GET  /status
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

// ---- Config (env-overridable so one binary works everywhere) -------------
const HTTP_PORT = parseInt(process.env.PORT || "4444", 10);
const SERIAL_PORT = process.env.SERIAL_PORT || "COM3";
const APP_VERSION = require("./package.json").version;

// ---- Optional: unix-print only exists on POSIX ---------------------------
let unixPrint = null;
if (os.platform() !== "win32") {
  try {
    unixPrint = require("unix-print");
  } catch (e) {
    console.warn("unix-print unavailable on this platform:", e.message);
  }
}

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "100mb" }));

// ---------------------------------------------------------------------------
// POST /display  — serial display (Windows only, via PowerShell)
// ---------------------------------------------------------------------------
app.post("/display", async (req, res) => {
  try {
    const { base64, text_line1, text_line2 } = req.body || {};
    let rawBuffer;

    if (base64) {
      rawBuffer = Buffer.from(base64, "base64");
    } else if (text_line1 !== undefined || text_line2 !== undefined) {
      const clearScreen = Buffer.from([0x0c]);
      const line1 = String(text_line1 || "")
        .substring(0, 20)
        .padEnd(20, " ");
      const line2 = String(text_line2 || "")
        .substring(0, 20)
        .padEnd(20, " ");
      rawBuffer = Buffer.concat([clearScreen, Buffer.from(line1 + line2)]);
    } else {
      return res.status(400).json({
        success: false,
        error:
          "Provide either a base64 payload, or text_line1 / text_line2 strings.",
      });
    }

    if (os.platform() !== "win32") {
      return res.status(500).json({
        success: false,
        error: "Serial display endpoint is only supported on Windows.",
      });
    }

    const tempDisplayPath = path.join(
      os.tmpdir(),
      `display_job_${Date.now()}.bin`,
    );
    fs.writeFileSync(tempDisplayPath, rawBuffer);
    const safePath = tempDisplayPath.replace(/\\/g, "\\\\");

    const serialScript = `
$port = New-Object System.IO.Ports.SerialPort '${SERIAL_PORT}', 9600, 'None', 8, 'One';
$port.Open();
$bytes = [System.IO.File]::ReadAllBytes('${safePath}');
$port.Write($bytes, 0, $bytes.Length);
$port.Close();
`;
    const encodedScript = Buffer.from(serialScript, "utf16le").toString(
      "base64",
    );

    exec(
      `powershell -NoProfile -EncodedCommand ${encodedScript}`,
      (error, stdout, stderr) => {
        try {
          if (fs.existsSync(tempDisplayPath)) fs.unlinkSync(tempDisplayPath);
        } catch (_) {}
        if (error) {
          console.error("Serial Port Display Error:", error);
          return res.status(500).json({ success: false, error: error.message });
        }
        console.log(`Display payload sent to ${SERIAL_PORT}`);
      },
    );

    return res.json({
      success: true,
      message: `Display payload sent to ${SERIAL_PORT}`,
    });
  } catch (error) {
    console.error("Display Update Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /printers  — list installed printers
// ---------------------------------------------------------------------------
function listPrinters() {
  return new Promise((resolve) => {
    if (os.platform() === "win32") {
      exec(
        `powershell -Command "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name"`,
        (error, stdout) => {
          if (error) return resolve([]);
          resolve(
            stdout
              .split(/\r?\n/)
              .map((n) => n.trim())
              .filter(Boolean),
          );
        },
      );
    } else {
      exec("lpstat -a", (error, stdout) => {
        if (error) return resolve([]);
        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => line.trim().split(/\s+/)[0])
            .filter(Boolean),
        );
      });
    }
  });
}

// ---------------------------------------------------------------------------
// POST /print  — raw ESC/POS to an installed printer
// ---------------------------------------------------------------------------
app.post("/print", async (req, res) => {
  let tempFilePath = null;

  try {
    const { printer_name, base64 } = req.body || {};

    if (!printer_name || !base64) {
      return res.status(400).json({
        success: false,
        error: "Missing printer_name or base64 payload.",
      });
    }

    // POSIX: validate the printer exists before trying to spool
    if (os.platform() !== "win32") {
      const available = await listPrinters();

      if (available.length === 0) {
        return res.status(400).json({
          success: false,
          error:
            "No printers are configured on this machine. Add a printer via System Settings (macOS) or system-config-printer (Linux), then retry.",
        });
      }

      const match = available.find(
        (p) => p.toLowerCase() === printer_name.toLowerCase(),
      );

      if (!match) {
        return res.status(400).json({
          success: false,
          error: `Printer "${printer_name}" not found. Available printers: ${available.join(", ")}.`,
        });
      }
    }

    tempFilePath = path.join(os.tmpdir(), `silent_job_${Date.now()}.bin`);
    fs.writeFileSync(tempFilePath, Buffer.from(base64, "base64"));

    // ---------- Windows: RAW spool through winspool.drv ----------
    if (os.platform() === "win32") {
      const safePath = tempFilePath.replace(/\\/g, "\\\\");

      const rawScript = `
$b = [System.IO.File]::ReadAllBytes('${safePath}');
$h = [IntPtr]::Zero;
$add = @'
using System;
using System.Runtime.InteropServices;
public class RawPrn {
    [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr def);
    [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr h, Int32 lvl, [In]DOCINFO di);
    [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")] public static extern bool WritePrinter(IntPtr h, IntPtr b, Int32 c, out Int32 w);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
}
'@;
Add-Type -TypeDefinition $add -ErrorAction SilentlyContinue;
if ([RawPrn]::OpenPrinter('${printer_name}', [ref]$h, [IntPtr]::Zero)) {
    $di = New-Object RawPrn+DOCINFO; $di.pDocName = 'Receipt'; $di.pDataType = 'RAW';
    if ([RawPrn]::StartDocPrinter($h, 1, $di)) {
        if ([RawPrn]::StartPagePrinter($h)) {
            $ptr = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length);
            [System.Runtime.InteropServices.Marshal]::Copy($b, 0, $ptr, $b.Length);
            $w = 0; [RawPrn]::WritePrinter($h, $ptr, $b.Length, [ref]$w);
            [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr);
            [RawPrn]::EndPagePrinter($h);
        }
        [RawPrn]::EndDocPrinter($h);
    }
    [RawPrn]::ClosePrinter($h);
}`;

      const encodedScript = Buffer.from(rawScript, "utf16le").toString(
        "base64",
      );

      exec(
        `powershell -NoProfile -EncodedCommand ${encodedScript}`,
        (error, stdout, stderr) => {
          try {
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
          } catch (_) {}
          if (error) {
            console.error("PowerShell RAW Spool Error:", error);
            console.error("Stderr:", stderr);
          } else {
            console.log(`Successfully spooled raw layout to: ${printer_name}`);
          }
        },
      );

      return res.json({
        success: true,
        message: `Spool command sent to ${printer_name}`,
      });
    }

    // ---------- macOS / Linux: CUPS via unix-print ----------
    if (!unixPrint) {
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (_) {}
      return res.status(500).json({
        success: false,
        error: "unix-print module not available.",
      });
    }

    try {
      await unixPrint.print(tempFilePath, printer_name);
    } catch (printError) {
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (_) {}

      const msg = (printError && printError.message) || String(printError);

      if (msg.includes("No such file or directory")) {
        const available = await listPrinters();
        return res.status(400).json({
          success: false,
          error: `Printer "${printer_name}" is not available to CUPS. Available printers: ${
            available.join(", ") || "none"
          }.`,
        });
      }
      return res.status(500).json({ success: false, error: msg });
    }

    try {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch (_) {}

    return res.json({
      success: true,
      message: `Successfully spooled to ${printer_name}`,
    });
  } catch (error) {
    console.error("Printing Error:", error);
    try {
      if (tempFilePath && fs.existsSync(tempFilePath))
        fs.unlinkSync(tempFilePath);
    } catch (_) {}
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /printers  &  GET /status
// ---------------------------------------------------------------------------
app.get("/printers", async (req, res) => {
  try {
    const printers = await listPrinters();
    return res.json({ success: true, printers });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    version: APP_VERSION,
    platform: os.platform(),
    arch: os.arch(),
    serial_port: SERIAL_PORT,
    http_port: HTTP_PORT,
  });
});

// ---------------------------------------------------------------------------
// Boot + graceful shutdown
// ---------------------------------------------------------------------------
const server = app.listen(HTTP_PORT, () => {
  console.log(`====================================================`);
  console.log(` Print & Display Agent v${APP_VERSION}`);
  console.log(` Listening on http://localhost:${HTTP_PORT}`);
  console.log(` Platform: ${os.platform()} / ${os.arch()}`);
  console.log(` Serial port: ${SERIAL_PORT}`);
  console.log(`====================================================`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
