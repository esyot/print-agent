const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

// Optional: only require unix-print on non-Windows platforms
let unixPrint = null;
if (os.platform() !== "win32") {
  try {
    unixPrint = require("unix-print");
  } catch (e) {
    console.warn("unix-print not available on this platform.");
  }
}

const app = express();

app.use(
  cors({
    origin: "*",
  }),
);

app.use(express.json({ limit: "100mb" }));

// ==========================================
// HELPER: Escape single quotes for PowerShell single-quoted strings
// ==========================================
function escapePS(str) {
  return String(str).replace(/'/g, "''");
}

// ==========================================
// HELPER: Run a PowerShell script encoded in UTF-16LE base64
// ==========================================
function runPowerShell(script, callback) {
  const scriptBuffer = Buffer.from(script, "utf16le");
  const encodedScript = scriptBuffer.toString("base64");
  exec(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
    { timeout: 30000 },
    callback,
  );
}

// ==========================================
// DISPLAY ENDPOINT (COM3) — Windows 10 compatible
// ==========================================
app.post("/display", async (req, res) => {
  try {
    const { base64, text_line1, text_line2 } = req.body;
    let rawBuffer;

    if (base64) {
      rawBuffer = Buffer.from(base64, "base64");
    } else if (text_line1 !== undefined || text_line2 !== undefined) {
      const clearScreen = Buffer.from([0x0c]); // Clear screen and home cursor

      const line1 = (text_line1 || "").substring(0, 20).padEnd(20, " ");
      const line2 = (text_line2 || "").substring(0, 20).padEnd(20, " ");
      const combinedPayload = line1 + line2;

      rawBuffer = Buffer.concat([clearScreen, Buffer.from(combinedPayload)]);
    } else {
      return res.status(400).json({
        success: false,
        error:
          "Provide either a base64 payload, or text_line1 / text_line2 strings.",
      });
    }

    if (os.platform() !== "win32") {
      return res
        .status(500)
        .json({ success: false, error: "Platform not supported." });
    }

    const tempDir = os.tmpdir();
    const tempDisplayPath = path.join(tempDir, `display_job_${Date.now()}.bin`);
    fs.writeFileSync(tempDisplayPath, rawBuffer);

    const safePath = escapePS(tempDisplayPath);

    const serialScript = `
$ErrorActionPreference = 'Stop'
try {
    $port = New-Object System.IO.Ports.SerialPort 'COM3', 9600, 'None', 8, 'One'
    $port.WriteTimeout = 5000
    $port.Open()
    $bytes = [System.IO.File]::ReadAllBytes('${safePath}')
    $port.Write($bytes, 0, $bytes.Length)
    $port.Close()
    Write-Output 'OK'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;

    runPowerShell(serialScript, (error, stdout, stderr) => {
      // Clean up temp file
      if (fs.existsSync(tempDisplayPath)) {
        try {
          fs.unlinkSync(tempDisplayPath);
        } catch (e) {}
      }

      if (error) {
        console.error("Serial Port Display Error:", error.message);
        console.error("Stderr:", stderr);
        return res.status(500).json({
          success: false,
          error: error.message,
          stderr: stderr ? stderr.trim() : undefined,
        });
      }

      console.log("Successfully pushed 40-character matrix to display.");
      return res.json({
        success: true,
        message: "Display payload sent to COM3",
      });
    });
  } catch (error) {
    console.error("Display Update Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// PRINTER ENDPOINT — Windows 10 compatible RAW spooling
// ==========================================
app.post("/print", async (req, res) => {
  let tempFilePath = null;

  try {
    const { printer_name, base64 } = req.body;

    if (!printer_name || !base64) {
      return res.status(400).json({
        success: false,
        error: "Missing printer_name or base64 payload.",
      });
    }

    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `silent_job_${Date.now()}.bin`);

    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(tempFilePath, buffer);

    if (os.platform() === "win32") {
      const safePath = escapePS(tempFilePath);
      const safePrinter = escapePS(printer_name);

      const rawScript = `
$ErrorActionPreference = 'Stop'
try {
    $b = [System.IO.File]::ReadAllBytes('${safePath}')
    $h = [IntPtr]::Zero
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
'@
    Add-Type -TypeDefinition $add -ErrorAction SilentlyContinue

    if (-not [RawPrn]::OpenPrinter('${safePrinter}', [ref]$h, [IntPtr]::Zero)) {
        throw "OpenPrinter failed for '${safePrinter}'"
    }

    $di = New-Object RawPrn+DOCINFO
    $di.pDocName = 'Receipt'
    $di.pDataType = 'RAW'

    if (-not [RawPrn]::StartDocPrinter($h, 1, $di)) {
        [RawPrn]::ClosePrinter($h)
        throw "StartDocPrinter failed"
    }

    if (-not [RawPrn]::StartPagePrinter($h)) {
        [RawPrn]::EndDocPrinter($h)
        [RawPrn]::ClosePrinter($h)
        throw "StartPagePrinter failed"
    }

    $ptr = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length)
    try {
        [System.Runtime.InteropServices.Marshal]::Copy($b, 0, $ptr, $b.Length)
        $w = 0
        if (-not [RawPrn]::WritePrinter($h, $ptr, $b.Length, [ref]$w)) {
            throw "WritePrinter failed"
        }
    } finally {
        [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
        [RawPrn]::EndPagePrinter($h)
        [RawPrn]::EndDocPrinter($h)
        [RawPrn]::ClosePrinter($h)
    }

    Write-Output 'OK'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;

      runPowerShell(rawScript, (error, stdout, stderr) => {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (e) {}
        }

        if (error) {
          console.error("PowerShell RAW Spool Error:", error.message);
          console.error("Stderr:", stderr);
          return res.status(500).json({
            success: false,
            error: error.message,
            stderr: stderr ? stderr.trim() : undefined,
          });
        }

        console.log(
          `Successfully spooled raw layout to Windows printer: ${printer_name}`,
        );
        return res.json({
          success: true,
          message: `Spool command sent to ${printer_name}`,
        });
      });

      return;
    }

    // Non-Windows fallback
    if (!unixPrint) {
      return res.status(500).json({
        success: false,
        error: "unix-print module not available on this platform.",
      });
    }

    await unixPrint.print(tempFilePath, printer_name);

    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }

    return res.json({
      success: true,
      message: `Successfully spooled to ${printer_name}`,
    });
  } catch (error) {
    console.error("Printing Error:", error);
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// LIST PRINTERS
// ==========================================
app.get("/printers", (req, res) => {
  if (os.platform() === "win32") {
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name"`,
      { timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }
        const printerList = stdout
          .split(/\r?\n/)
          .map((n) => n.trim())
          .filter((n) => n !== "");
        return res.json({ success: true, printers: printerList });
      },
    );
  } else {
    exec("lpstat -e", (error, stdout) => {
      if (error) {
        return res.json({ success: true, printers: [] });
      }
      const printerList = stdout
        .split(/\r?\n/)
        .map((n) => n.trim())
        .filter((n) => n !== "");
      return res.json({ success: true, printers: printerList });
    });
  }
});

// ==========================================
// STATUS
// ==========================================
app.get("/status", (req, res) => {
  res.json({
    status: "online",
    platform: os.platform(),
    arch: os.arch(),
    node: process.version,
    windowsBuild: os.platform() === "win32" ? os.release() : undefined,
  });
});

const PORT = 4444;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Print & Display Agent Active on http://localhost:${PORT}`);
  console.log(` Platform: ${os.platform()} | Node: ${process.version}`);
  console.log(`====================================================`);
});
