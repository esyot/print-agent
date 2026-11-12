; installer/windows.iss
; Inno Setup script — installs the agent as a Windows Service via NSSM.

#define AppName        "Silent Print Agent"
#define AppVersion     "1.0.4"
#define AppPublisher   "Your Company"
#define AppURL         "https://example.com"
#define AppExeName     "print-agent.exe"
#define NssmExe        "nssm.exe"
#define ServiceName    "SilentPrintAgent"

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

[Files]
; 64-bit binary
Source: "..\dist\print-agent-{#AppVersion}-win-x64.exe"; \
  DestName: "{#AppExeName}"; DestDir: "{app}"; \
  Check: IsWin64; Flags: ignoreversion
; 32-bit fallback
Source: "..\dist\print-agent-{#AppVersion}-win-x86.exe"; \
  DestName: "{#AppExeName}"; DestDir: "{app}"; \
  Check: not IsWin64; Flags: ignoreversion skipifsourcedoesntexist
; NSSM — Windows Service wrapper
Source: "..\dist\{#NssmExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; 1. Install the service
Filename: "{app}\{#NssmExe}"; \
  Parameters: "install {#ServiceName} ""{app}\{#AppExeName}"""; \
  Flags: runhidden waituntilterminated; StatusMsg: "Installing service..."
; 2. Configure auto-start at boot
Filename: "{app}\{#NssmExe}"; \
  Parameters: "set {#ServiceName} Start SERVICE_AUTO_START"; \
  Flags: runhidden waituntilterminated; StatusMsg: "Configuring auto-start..."
; 3. Redirect logs (useful for debugging)
Filename: "{app}\{#NssmExe}"; \
  Parameters: "set {#ServiceName} AppStdout ""{app}\stdout.log"""; \
  Flags: runhidden waituntilterminated
Filename: "{app}\{#NssmExe}"; \
  Parameters: "set {#ServiceName} AppStderr ""{app}\stderr.log"""; \
  Flags: runhidden waituntilterminated
; 4. Start the service now
Filename: "{app}\{#NssmExe}"; \
  Parameters: "start {#ServiceName}"; \
  Flags: runhidden waituntilterminated; StatusMsg: "Starting agent..."

[UninstallRun]
; Stop and remove the service
Filename: "{app}\{#NssmExe}"; Parameters: "stop {#ServiceName}"; \
  Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{app}\{#NssmExe}"; Parameters: "remove {#ServiceName} confirm"; \
  Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExeName}"; \
  Flags: runhidden; RunOnceId: "KillAgent"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  // Stop existing service on upgrade
  if FileExists(ExpandConstant('{app}\{#NssmExe}')) then
  begin
    Exec(ExpandConstant('{app}\{#NssmExe}'), 'stop {#ServiceName}',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{app}\{#NssmExe}'), 'remove {#ServiceName} confirm',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  // Kill any stray process
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExeName}',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;