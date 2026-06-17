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

app.get("/status", (req, res) => {
  res.json({ status: "online", platform: os.platform() });
});

const PORT = 4444;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Silent Print Agent Active on http://localhost:${PORT}`);
  console.log(`====================================================`);
});
