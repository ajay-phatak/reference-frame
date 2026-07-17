#!/usr/bin/env bash
# Builds the PyInstaller engine into engine/dist/refframe-engine.
#
# Pinned to Python 3.12 (PyInstaller target; pyproject requires-python <3.13).
# Mac wheels for torch/torchvision are already CPU/MPS (no CUDA variant
# exists), so unlike build-engine.ps1 there's no --index-url whl/cpu dance --
# default PyPI is fine. Same step order and assertions as the ps1 otherwise.
#
# Bash port of build-engine.ps1 for macOS CI runners. Keep the ps1 untouched;
# this is a second script, one per build OS.
#
# set -u catches unbound-variable typos; we deliberately do NOT use set -e --
# like the ps1's Invoke-Step, run_step checks each command's exit code
# explicitly so a step's own diagnostic output isn't mistaken for failure.
set -u

run_step() {
    local name="$1"
    shift
    echo "==> $name"
    "$@"
    local status=$?
    if [ "$status" -ne 0 ]; then
        echo "FAILED: $name (exit $status)"
        exit 1
    fi
}

build_start=$(date +%s)

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine="$repo/engine"
venv="$engine/.venv-build"
spec="$engine/refframe-engine.spec"

py="$venv/bin/python"
pip="$venv/bin/pip"
pyi="$venv/bin/pyinstaller"

# Build venv (create once, reuse thereafter). Prefer python3.12 explicitly;
# fall back to python3 but verify it's actually 3.12 before trusting it.
if [ ! -d "$venv" ]; then
    if command -v python3.12 >/dev/null 2>&1; then
        py_launcher="python3.12"
    else
        py_launcher="python3"
        version_out="$("$py_launcher" --version 2>&1)"
        case "$version_out" in
            "Python 3.12"*) ;;
            *)
                echo "FAILED: python3.12 not on PATH and python3 is '$version_out', not 3.12"
                exit 1
                ;;
        esac
    fi
    run_step "create build venv ($py_launcher -m venv)" "$py_launcher" -m venv "$venv"
    run_step "upgrade pip" "$py" -m pip install --quiet --upgrade pip
fi

# torch + torchvision from default PyPI -- mac wheels are already CPU/MPS, no
# +cpu local-version tag (those don't exist for mac wheels) and no
# --index-url override needed.
run_step "install torch + torchvision" \
    "$pip" install --quiet "torch==2.11.0" "torchvision==0.26.0"

# Engine (pinned deps) + PyInstaller. torch/torchvision are already satisfied
# by the wheels above, so ultralytics resolves against them.
run_step "install engine + pyinstaller" \
    "$pip" install --quiet "$engine" pyinstaller

# rtmlib hard-depends on unpinned opencv-contrib-python, which pip resolves to
# a NEWER cv2 that clobbers the engine's pinned opencv-python (both ship the
# same cv2/ package; last-installed wins, so the frozen bundle would carry the
# wrong cv2 vs the source pipeline). Strip the stray variants, force the pin
# back, then assert the venv's cv2 is exactly the source version.
run_step "repair opencv pin (rtmlib pulls contrib)" \
    "$pip" uninstall --quiet -y opencv-contrib-python opencv-python-headless
run_step "reinstall pinned opencv-python" \
    "$pip" install --quiet --force-reinstall --no-deps "opencv-python==4.13.0.92"
run_step "verify cv2 == 4.13.0" \
    "$py" -c "import cv2, sys; sys.exit(0 if cv2.__version__ == '4.13.0' else 1)"

# Freeze.
cd "$engine"
run_step "pyinstaller" \
    "$pyi" --noconfirm \
        --distpath "$engine/dist" \
        --workpath "$engine/build" \
        "$spec"

exe="$engine/dist/refframe-engine/refframe-engine"
if [ ! -f "$exe" ]; then
    echo "FAILED: build produced no exe at $exe"
    exit 1
fi

# Post-build smoke: doctor on a throwaway data dir. doctor imports torch +
# onnxruntime (the frozen-runtime canaries) and resolves imageio-ffmpeg. Exit 1
# is EXPECTED (weights aren't downloaded yet); we only assert the exe launches
# and its checks run. A PyInstaller import failure surfaces as a bootstrap
# traceback with an exit code that is neither 0 nor 1.
smoke_dir="$(mktemp -d "${TMPDIR:-/tmp}/refframe-build-smoke-XXXXXX")"
echo "==> smoke: doctor --data-dir $smoke_dir"
"$exe" doctor --data-dir "$smoke_dir"
doctor_exit=$?
rm -rf "$smoke_dir"
if [ "$doctor_exit" -ne 0 ] && [ "$doctor_exit" -ne 1 ]; then
    echo "FAILED: doctor smoke crashed (exit $doctor_exit) - frozen import problem"
    exit 1
fi

build_end=$(date +%s)
mins=$(awk "BEGIN { printf \"%.1f\", ($build_end - $build_start) / 60 }")
echo ""
echo "Engine built: $exe"
echo "Build time: $mins min"
# The doctor smoke intentionally tolerates exit 1 (missing weights), but its
# exit code would otherwise leak out as this script's exit code and make
# every successful build look failed to callers.
exit 0
