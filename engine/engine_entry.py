"""PyInstaller entry point for the engine exe."""
import sys

from refframe_engine.cli import main

if __name__ == "__main__":
    sys.exit(main())
