"""Bulk-ingest a folder (synchronously) — for loading an archive before a demo.

    uv run python scripts/ingest_folder.py ../corpus/sample
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from stratum import db  # noqa: E402
from stratum.ingest import pipeline, store  # noqa: E402


def main(folder: str) -> None:
    files = sorted(p for p in Path(folder).rglob("*") if p.is_file() and p.suffix.lower() in store.SUPPORTED)
    print(f"{len(files)} files in {folder}")
    for path in files:
        started = time.time()
        document_id, is_new = pipeline.register_upload(path.read_bytes(), path.name)
        if not is_new and (db.row("SELECT status FROM documents WHERE id=?", (document_id,)) or {}).get("status") == "ready" and "--force" not in sys.argv:
            print(f"  = {path.name} (already ingested)")
            continue
        try:
            result = pipeline.run(document_id)
            print(f"  + {path.name}: {result['detail']} ({time.time() - started:.1f}s)")
        except Exception as error:  # noqa: BLE001
            import traceback

            traceback.print_exc()
            db.execute("UPDATE documents SET status='failed', status_detail=? WHERE id=?", (str(error)[:500], document_id))
            print(f"  ! {path.name}: {error}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parents[2] / "corpus" / "sample"))
