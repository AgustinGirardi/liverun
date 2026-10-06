; LiveRun Inno Setup Script
; Compilar manualmente:  ISCC.exe /DAppVersion=3.0 LiveRun_Setup.iss
; El build.bat pasa la versión automáticamente.
;
; OJO: el AppId NO se cambia con el rename ChronoTrack→LiveRun. Es la identidad
; de la instalación: con el mismo AppId, el instalador actualiza EN EL MISMO
; directorio y la base (chronotrack.db, nombre interno que se conserva) y la
; config quedan intactas.

#define AppName      "LiveRun"
#define AppPublisher "LiveRun"
#define AppExeName   "LiveRun.exe"

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
OutputBaseFilename=LiveRun_Setup_v{#AppVersion}
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
Source: "dist\LiveRun\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Al actualizar desde ChronoTrack, el exe viejo quedaría huérfano al lado del nuevo.
Type: files; Name: "{app}\ChronoTrack.exe"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}";  Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Lanzar {#AppName}"; Flags: nowait postinstall skipifsilent

; Sin [UninstallDelete] sobre {app}: ahí viven la base (chronotrack.db) y la
; config, y antes se borraban sin preguntar. El desinstalador quita sólo los
; archivos que instaló; los datos se borran únicamente si el usuario lo pide
; (ver CurUninstallStepChanged).

[Code]
// Cerrar la app si está corriendo antes de instalar (el nombre nuevo y el
// viejo, por las actualizaciones desde ChronoTrack).
procedure CurStepChanged(CurStep: TSetupStep);
var ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    Exec('taskkill.exe', '/f /im LiveRun.exe', '', SW_HIDE, ewNoWait, ResultCode);
    Exec('taskkill.exe', '/f /im ChronoTrack.exe', '', SW_HIDE, ewNoWait, ResultCode);
  end;
end;

// Al desinstalar, los datos (carreras, inscriptos, tiempos, config) se
// conservan salvo que el usuario elija borrarlos. "No" es el botón por
// defecto y la desinstalación silenciosa nunca los borra.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if not UninstallSilent and DirExists(ExpandConstant('{app}')) then
    begin
      if MsgBox(#$BF + 'Borrar tambi' + #$E9 + 'n los datos de LiveRun (carreras, inscriptos y tiempos)?' + #13#10 + #13#10 +
                'Si eleg' + #$ED + 's "No", quedan en ' + ExpandConstant('{app}') + ' y la pr' + #$F3 + 'xima instalaci' + #$F3 + 'n los vuelve a usar.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(ExpandConstant('{app}'), True, True, True);
    end;
  end;
end;
