"""Reference Frame analysis engine.

Vendored from the private WCS Dance Analysis pipeline; adapted for packaged
distribution (path injection, NDJSON progress events, single CLI). The
vendored modules keep their original names and (outside NDJSON mode) their
original print/output behaviour so engine changes stay golden-diffable against
the source pipeline.
"""

__version__ = "0.1.0"
