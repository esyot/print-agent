const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const os = require("os");
const pt = require("pdf-to-printer");
const unixPrint = require("unix-print");

const app = express();

// Enable CORS so your production web app domain can communicate with localhost safely
app.use(
  cors({
    origin: "*", // In production, replace with your specific web app URL if desired
  }),
);

// Set limit high enough to accept large high-res print/document payloads
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

    // 1. Generate a temporary file path native to the OS
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `silent_job_${Date.now()}.bin`);

    // 2. Convert base64 data back into raw binary buffer
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(tempFilePath, buffer);

    // 3. Spool to OS Printer without dialog boxes or popups
    if (os.platform() === "win32") {
      await pt.print(tempFilePath, { printer: printer_name });
    } else {
      // macOS and Linux uses CUPS subsystem
      await unixPrint.print(tempFilePath, printer_name);
    }

    // 4. Fire-and-forget cleanup of local disk space
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    return res.json({
      success: true,
      message: `Successfully spooled to ${printer_name}`,
    });
  } catch (error) {
    console.error("Printing Error:", error);

    // Cleanup file if an exception occurred midway
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    return res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint to allow frontend to detect if the agent is open and running
app.get("/status", (req, res) => {
  res.json({ status: "online", platform: os.platform() });
});

const PORT = 4444;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Silent Print Agent Active on http://localhost:${PORT}`);
  console.log(`====================================================`);
});
