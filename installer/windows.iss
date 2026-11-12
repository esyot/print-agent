; installer/windows.iss
; Inno Setup script — builds a single .exe installer for Windows 8/10/11 (x86 + x64).
; Build with: iscc installer\windows.iss
; Output:     installer\Output\PrintAgent-1.0.0-setup.exe

#define AppName        "Silent Print Agent"
#define AppVersion     "1.0.0"
#define AppPublisher   "Your Company"
#define AppURL         "https://example.com"
#define AppExeName     "print-agent.exe"

[Setup]
AppId={{A1B2C3D4-0000-0000-0000-SILENTPRINT}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
DefaultDirName={autopf}\SilentPrintAgent
DefaultGroupName={#AppName}
OutputDir=Output
OutputBaseFilename=PrintAgent-{#AppVersion}-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Start agent automatically on login"; GroupDescription: "Startup:"

[Files]
; 64-bit binary
Source: "..\dist\print-agent-{#AppVersion}-win-x64.exe"; \
  DestName: "{#AppExeName}"; DestDir: "{app}"; \
  Check: IsWin64; Flags: ignoreversion
; 32-bit fallback
Source: "..\dist\print-agent-{#AppVersion}-win-x86.exe"; \
  DestName: "{#AppExeName}"; DestDir: "{app}"; \
  Check: not IsWin64; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Registry]
; Autostart (HKCU so it applies per user)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "SilentPrintAgent"; \
  ValueData: """{app}\{#AppExeName}"""; \
  Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Start agent now"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
; Kill the process before uninstall
Filename: "taskkill.exe"; Parameters: "/F /IM {#AppExeName}"; \
  Flags: runhidden; RunOnceId: "KillAgent"