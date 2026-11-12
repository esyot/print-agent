; installer/windows.iss
; Inno Setup script — VBS-based silent autostart with verification.

#define AppName        "Silent Print Agent"
#define AppVersion     "1.0.3"
#define AppPublisher   "Your Company"
#define AppURL         "https://example.com"
#define AppExeName     "print-agent.exe"
#define AppVbsName     "print-agent-launcher.vbs"

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
Name: "autostart"; Description: "Start agent automatically on login (silent)"; GroupDescription: "Startup:"

[Files]
Source: "..\dist\print-agent-{#AppVersion}-win-x64.exe"; \
  DestName: "{#AppExeName}"; DestDir: "{app}"; \
  Check: IsWin64; Flags: ignoreversion
Source: "..\dist\print-agent-{#AppVersion}-win-x86.exe"; \
  DestName: "{#AppExeName}"; DestDir: "{app}"; \
  Check: not IsWin64; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\dist\{#AppVbsName}"; \
  DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
; ★ Critical: {sys}\wscript.exe (absolute path) — NOT "wscript.exe"
Name: "{userstartup}\{#AppName}"; \
  Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\{#AppVbsName}"""; \
  WorkingDir: "{app}"; \
  IconFilename: "{app}\{#AppExeName}"; \
  Comment: "Silent Print Agent (auto-start, hidden)"; \
  Tasks: autostart

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Start agent now"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExeName}"; \
  Flags: runhidden; RunOnceId: "KillAgent"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  // Kill any running instances (for upgrades)
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExeName}',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Also kill wscript processes matching our VBS
  Exec(ExpandConstant('{sys}\taskkill.exe'),
       '/F /IM wscript.exe /FI "WINDOWTITLE eq Silent*"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  VbsPath, LnkPath: String;
begin
  if CurStep = ssPostInstall then
  begin
    VbsPath := ExpandConstant('{app}\{#AppVbsName}');
    LnkPath := ExpandConstant('{userstartup}\{#AppName}.lnk');

    if not FileExists(VbsPath) then
      MsgBox('Warning: ' + VbsPath + ' was not installed.' + #13#10 +
             'Auto-start on login will NOT work. Please re-run the installer.',
             mbError, MB_OK);

    // Only warn about the shortcut if the user chose autostart
    if IsTaskSelected('autostart') and not FileExists(LnkPath) then
      MsgBox('Warning: Startup shortcut was not created at:' + #13#10 +
             LnkPath + #13#10 +
             'Auto-start on login will NOT work. Please re-run the installer.',
             mbError, MB_OK);
  end;
end;