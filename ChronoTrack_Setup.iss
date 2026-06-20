; ChronoTrack Inno Setup Script
; Compilar manualmente:  ISCC.exe /DAppVersion=2.1 ChronoTrack_Setup.iss
; El build.bat pasa la versión automáticamente.

#define AppName      "ChronoTrack"
#define AppPublisher "ChronoTrack"
#define AppExeName   "ChronoTrack.exe"

; AppVersion se inyecta desde build.bat con /DAppVersion=x.y
; Si se compila a mano sin /D, usa "2.0" como fallback.
#ifndef AppVersion
  #define AppVersion "2.0"
#endif

[Setup]
AppId={{B7E4C3A2-1F5D-4E8B-9A6C-D2F0E1B3C4A5}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\{#AppName}
DisableProgramGroupPage=yes
OutputDir=installer
OutputBaseFilename=ChronoTrack_Setup_v{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=icon.ico
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName} v{#AppVersion}
MinVersion=10.0
CloseApplications=force
RestartIfNeededByRun=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el Escritorio"; GroupDescription: "Accesos directos:"

[Files]
Source: "dist\ChronoTrack\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}";  Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Lanzar {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// Cerrar ChronoTrack si está corriendo antes de instalar
procedure CurStepChanged(CurStep: TSetupStep);
var ResultCode: Integer;
begin
  if CurStep = ssInstall then
    Exec('taskkill.exe', '/f /im ChronoTrack.exe', '', SW_HIDE, ewNoWait, ResultCode);
end;
