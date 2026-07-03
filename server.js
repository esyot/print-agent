const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const os = require("os");
const unixPrint = require("unix-print");
const { exec } = require("child_process");

const app = express();

app.use(
  cors({
    origin: "*",
  }),
);

app.use(express.json({ limit: "100mb" }));

// ==========================================
// NEW: CUSTOMER DISPLAY ENDPOINT (COM3)
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

    if (os.platform() === "win32") {
      const tempDir = os.tmpdir();
      const tempDisplayPath = path.join(
        tempDir,
        `display_job_${Date.now()}.bin`,
      );
      fs.writeFileSync(tempDisplayPath, rawBuffer);

      const safePath = tempDisplayPath.replace(/\\/g, "\\\\");

      const serialScript = `
$port = New-Object System.IO.Ports.SerialPort 'COM3', 9600, 'None', 8, 'One';
$port.Open();
$bytes = [System.IO.File]::ReadAllBytes('${safePath}');
$port.Write($bytes, 0, $bytes.Length);
$port.Close();
`;

      const scriptBuffer = Buffer.from(serialScript, "utf16le");
      const encodedScript = scriptBuffer.toString("base64");

      exec(
        `powershell -NoProfile -EncodedCommand ${encodedScript}`,
        (error, stdout, stderr) => {
          if (fs.existsSync(tempDisplayPath)) {
            try {
              fs.unlinkSync(tempDisplayPath);
            } catch (e) {}
          }
          if (error) {
            console.error("Serial Port Display Error:", error);
            return res
              .status(500)
              .json({ success: false, error: error.message });
          }
          console.log("Successfully pushed 40-character matrix to display.");
        },
      );

      return res.json({
        success: true,
        message: "Display payload sent to COM3",
      });
    } else {
      return res
        .status(500)
        .json({ success: false, error: "Platform not supported." });
    }
  } catch (error) {
    console.error("Display Update Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// EXISTING: PRINTER LOGIC
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

      const scriptBuffer = Buffer.from(rawScript, "utf16le");
      const encodedScript = scriptBuffer.toString("base64");

      exec(
        `powershell -NoProfile -EncodedCommand ${encodedScript}`,
        (error, stdout, stderr) => {
          if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
              fs.unlinkSync(tempFilePath);
            } catch (e) {}
          }

          if (error) {
            console.error("PowerShell RAW Spool Error:", error);
            console.error("Stderr:", stderr);
          } else {
            console.log(
              `Successfully spooled raw layout to Windows printer: ${printer_name}`,
            );
          }
        },
      );

      return res.json({
        success: true,
        message: `Spool command sent to ${printer_name}`,
      });
    } else {
      await unixPrint.print(tempFilePath, printer_name);

      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      return res.json({
        success: true,
        message: `Successfully spooled to ${printer_name}`,
      });
    }
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

app.get("/printers", (req, res) => {
  if (os.platform() === "win32") {
    exec(
      `powershell -Command "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name"`,
      (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }
        const printerList = stdout
          .split(/\r?\n/)
          .filter((name) => name.trim() !== "");
        return res.json({ success: true, printers: printerList });
      },
    );
  } else {
    exec("lpstat -e", (error, stdout, stderr) => {
      if (error) {
        return res.json({ success: true, printers: [] });
      }
      const printerList = stdout
        .split(/\r?\n/)
        .filter((name) => name.trim() !== "");
      return res.json({ success: true, printers: printerList });
    });
  }
});

app.get("/status", (req, res) => {
  res.json({ status: "online", platform: os.platform() });
});

const PORT = 4444;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Print & Display Agent Active on http://localhost:${PORT}`);
  console.log(`====================================================`);
});
