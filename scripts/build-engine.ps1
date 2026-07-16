# Builds the PyInstaller engine into engine/dist/refframe-engine.
#
# Pinned to Python 3.12 (PyInstaller target; pyproject requires-python <3.13).
# The build venv installs CPU-only torch FIRST (--index-url .../whl/cpu) so the
# bundle doesn't balloon with CUDA, then the engine + PyInstaller.
#
# PowerShell 5.1 gotchas:
#  - Native commands (pip, pyinstaller) write progress to stderr, so do NOT set
#    $ErrorActionPreference = 'Stop' here; a spurious NativeCommandError would
#    abort a successful build. Check $LASTEXITCODE explicitly via Invoke-Step.
#  - 5.1 reads a BOM-less .ps1 as ANSI, so keep this file ASCII-only (no box
#    drawing / em dashes) or quote parsing breaks. CI runs under pwsh; both work.

function Invoke-Step {
    param([string]$Name, [scriptblock]$Cmd)
    Write-Host "==> $Name"
    & $Cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $Name (exit $LASTEXITCODE)"
        exit 1
    }
}

$buildStart = Get-Date

$repo   = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $repo "engine"
$venv   = Join-Path $engine ".venv-build"
$spec   = Join-Path $engine "refframe-engine.spec"

$py     = Join-Path $venv "Scripts\python.exe"
$pip    = Join-Path $venv "Scripts\pip.exe"
$pyi    = Join-Path $venv "Scripts\pyinstaller.exe"

# Build venv (create once, reuse thereafter).
if (-not (Test-Path $venv)) {
    Invoke-Step "create build venv (py -3.12)" { py -3.12 -m venv $venv }
    Invoke-Step "upgrade pip" { & $py -m pip install --quiet --upgrade pip }
}

# CPU-only torch FIRST (before the engine pulls it transitively as CUDA).
Invoke-Step "install CPU torch + torchvision" {
    & $pip install --quiet `
        --index-url https://download.pytorch.org/whl/cpu `
        "torch==2.11.0+cpu" "torchvision==0.26.0+cpu"
}

# Engine (pinned deps) + PyInstaller. torch/torchvision are already satisfied by
# the CPU wheels above, so ultralytics resolves against them, not a CUDA build.
Invoke-Step "install engine + pyinstaller" {
    & $pip install --quiet $engine pyinstaller
}

# rtmlib hard-depends on unpinned opencv-contrib-python, which pip resolves to a
# NEWER cv2 that clobbers the engine's pinned opencv-python (both ship the same
# cv2/ package; last-installed wins, so the frozen bundle would carry the wrong
# cv2 vs the source pipeline). Strip the stray variants, force the pin back,
# then assert the venv's cv2 is exactly the source version.
Invoke-Step "repair opencv pin (rtmlib pulls contrib)" {
    & $pip uninstall --quiet -y opencv-contrib-python opencv-python-headless
    & $pip install --quiet --force-reinstall --no-deps "opencv-python==4.13.0.92"
}
Invoke-Step "verify cv2 == 4.13.0" {
    & $py -c "import cv2, sys; sys.exit(0 if cv2.__version__ == '4.13.0' else 1)"
}

# Freeze.
Set-Location $engine
Invoke-Step "pyinstaller" {
    & $pyi --noconfirm `
        --distpath (Join-Path $engine "dist") `
        --workpath (Join-Path $engine "build") `
        $spec
}

$exe = Join-Path $engine "dist\refframe-engine\refframe-engine.exe"
if (-not (Test-Path $exe)) {
    Write-Host "FAILED: build produced no exe at $exe"
    exit 1
}

# Post-build smoke: doctor on a throwaway data dir. doctor imports torch +
# onnxruntime (the frozen-runtime canaries) and resolves imageio-ffmpeg. Exit 1
# is EXPECTED (weights aren't downloaded yet); we only assert the exe launches
# and its checks run. A PyInstaller import failure surfaces as a bootstrap
# traceback with an exit code that is neither 0 nor 1.
$smokeDir = Join-Path $env:TEMP ("refframe-build-smoke-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $smokeDir | Out-Null
Write-Host "==> smoke: doctor --data-dir $smokeDir"
& $exe doctor --data-dir $smokeDir
$doctorExit = $LASTEXITCODE
Remove-Item -Recurse -Force $smokeDir -ErrorAction SilentlyContinue
if ($doctorExit -ne 0 -and $doctorExit -ne 1) {
    Write-Host "FAILED: doctor smoke crashed (exit $doctorExit) - frozen import problem"
    exit 1
}

$mins = [math]::Round(((Get-Date) - $buildStart).TotalMinutes, 1)
Write-Host ""
Write-Host "Engine built: $exe"
Write-Host "Build time: $mins min"
# The doctor smoke intentionally tolerates exit 1 (missing weights), but its
# $LASTEXITCODE would otherwise leak out as this script's exit code and make
# every successful build look failed to callers.
exit 0
